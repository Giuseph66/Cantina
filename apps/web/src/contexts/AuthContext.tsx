import {
    createContext,
    useContext,
    useState,
    useCallback,
    ReactNode,
    useEffect,
} from 'react';
import { appendCsrfHeader } from '../lib/csrf';
import { encryptedFetch as fetch } from '../lib/encrypted-fetch';
import { onRecovered, reportFailure, reportResponse } from '../lib/server-status';

export interface AuthUser {
    id: string;
    name: string;
    email: string;
    role: string;
    pictureUrl: string | null;
    emailVerified: boolean;
    cpf: string | null;
    phone: string | null;
    isProfileComplete: boolean;
}

interface AuthContextValue {
    user: AuthUser | null;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<AuthUser>;
    register: (name: string, email: string, password: string) => Promise<AuthUser>;
    loginWithGoogle: (credential: string) => Promise<AuthUser>;
    updateProfile: (cpf: string, phone: string) => Promise<AuthUser>;
    logout: () => Promise<void>;
    refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
    const err = await res.json().catch(() => ({}));
    return typeof err.message === 'string' ? err.message : fallback;
}

function buildHeaders(method: string, init?: HeadersInit) {
    const headers = new Headers(init);
    appendCsrfHeader(headers, method);
    return headers;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const refreshSession = useCallback(async () => {
        const res = await fetch('/api/v1/auth/me', {
            method: 'GET',
            credentials: 'include',
        });

        // Primeira requisição da aplicação: é ela que revela um servidor fora do ar no boot.
        reportResponse(res);

        if (res.status === 401) {
            setUser(null);
            return;
        }

        if (!res.ok) {
            throw new Error(await readErrorMessage(res, 'Falha ao carregar sessao'));
        }

        const data = (await res.json()) as AuthUser;
        setUser(data);
    }, []);

    useEffect(() => {
        refreshSession()
            .catch((err) => {
                console.error('[Auth] Falha ao restaurar sessao', err);
                reportFailure(err);
                setUser(null);
            })
            .finally(() => {
                setIsLoading(false);
            });
    }, [refreshSession]);

    // O provider fica acima das rotas e não remonta na reconexão: revalida a sessão na mão.
    useEffect(() => onRecovered(() => {
        refreshSession().catch(() => setUser(null));
    }), [refreshSession]);

    const login = useCallback(async (email: string, password: string) => {
        const normalizedEmail = email.trim().toLowerCase();
        const res = await fetch('/api/v1/auth/login', {
            method: 'POST',
            headers: buildHeaders('POST', { 'Content-Type': 'application/json' }),
            credentials: 'include',
            body: JSON.stringify({ email: normalizedEmail, password }),
        });

        if (!res.ok) {
            throw new Error(await readErrorMessage(res, 'Credenciais invalidas'));
        }

        const data = (await res.json()) as { user: AuthUser };
        setUser(data.user);
        return data.user;
    }, []);

    const register = useCallback(async (name: string, email: string, password: string) => {
        const normalizedEmail = email.trim().toLowerCase();
        const res = await fetch('/api/v1/auth/register', {
            method: 'POST',
            headers: buildHeaders('POST', { 'Content-Type': 'application/json' }),
            credentials: 'include',
            body: JSON.stringify({ name: name.trim(), email: normalizedEmail, password }),
        });

        if (!res.ok) {
            throw new Error(await readErrorMessage(res, 'Falha ao criar conta'));
        }

        const data = (await res.json()) as { user: AuthUser };
        setUser(data.user);
        return data.user;
    }, []);

    const loginWithGoogle = useCallback(async (credential: string) => {
        const res = await fetch('/api/v1/auth/google', {
            method: 'POST',
            headers: buildHeaders('POST', { 'Content-Type': 'application/json' }),
            credentials: 'include',
            body: JSON.stringify({ credential }),
        });

        if (!res.ok) {
            throw new Error(await readErrorMessage(res, 'Falha ao autenticar com Google'));
        }

        const data = (await res.json()) as { user: AuthUser };
        setUser(data.user);
        return data.user;
    }, []);

    const updateProfile = useCallback(async (cpf: string, phone: string) => {
        const res = await fetch('/api/v1/auth/profile', {
            method: 'PATCH',
            headers: buildHeaders('PATCH', { 'Content-Type': 'application/json' }),
            credentials: 'include',
            body: JSON.stringify({
                cpf: cpf.replace(/\D/g, ''),
                phone: phone.replace(/\D/g, ''),
            }),
        });

        if (!res.ok) {
            throw new Error(await readErrorMessage(res, 'Falha ao atualizar perfil'));
        }

        const data = (await res.json()) as AuthUser;
        setUser(data);
        return data;
    }, []);

    const logout = useCallback(async () => {
        try {
            await fetch('/api/v1/auth/logout', {
                method: 'POST',
                headers: buildHeaders('POST'),
                credentials: 'include',
            });
        } finally {
            setUser(null);
        }
    }, []);

    return (
        <AuthContext.Provider value={{ user, isLoading, login, register, loginWithGoogle, updateProfile, logout, refreshSession }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
    return ctx;
}
