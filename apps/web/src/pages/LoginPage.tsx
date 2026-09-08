import { useState, FormEvent, useEffect, useMemo, useRef } from 'react';
import { encryptedFetch as fetch } from '../lib/encrypted-fetch';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Eye, EyeOff, ArrowRight, ChevronLeft } from 'lucide-react';
import styles from './LoginPage.module.css';
import { getDefaultRouteForRole, normalizeNextRoute } from '../utils/authRouting';

const FOOD_PHOTOS = [
    { src: '/images/login-assado.png', alt: 'Assado' },
    { src: '/images/login-cafe.png', alt: 'Café com Leite' },
    { src: '/images/login-misto.png', alt: 'Misto Quente' },
    { src: '/images/login-burguer.png', alt: 'X-Burguer' },
];

type AuthPublicConfig = {
    googleClientId: string | null;
    googleEnabled: boolean;
};

type GoogleCredentialResponse = {
    credential?: string;
};

let googleScriptPromise: Promise<void> | null = null;

function loadGoogleScript() {
    if (googleScriptPromise) return googleScriptPromise;

    googleScriptPromise = new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('Falha ao carregar Google Identity Services.')), { once: true });
            if ((window as any).google?.accounts?.id) resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.dataset.googleIdentity = 'true';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Falha ao carregar Google Identity Services.'));
        document.head.appendChild(script);
    });

    return googleScriptPromise;
}

async function readErrorMessage(res: Response, fallback: string) {
    const err = await res.json().catch(() => ({}));
    return typeof err.message === 'string' ? err.message : fallback;
}

export default function LoginPage() {
    const { login, loginWithGoogle, user, isLoading } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const next = searchParams.get('next');
    const googleButtonRef = useRef<HTMLDivElement | null>(null);
    const googleInitializedClientIdRef = useRef<string | null>(null);

    const [config, setConfig] = useState<AuthPublicConfig>({ googleClientId: null, googleEnabled: false });
    const [loadingConfig, setLoadingConfig] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);

    const targetAfterLogin = useMemo(() => {
        return normalizeNextRoute(next);
    }, [next]);

    useEffect(() => {
        document.documentElement.style.overflowY = 'hidden';
        return () => { document.documentElement.style.overflowY = ''; };
    }, []);

    useEffect(() => {
        fetch('/api/v1/auth/public-config', {
            method: 'GET',
            credentials: 'include',
        })
            .then(async (res) => {
                if (!res.ok) throw new Error(await readErrorMessage(res, 'Falha ao carregar autenticação'));
                return res.json() as Promise<AuthPublicConfig>;
            })
            .then(setConfig)
            .catch((err) => setError(err instanceof Error ? err.message : 'Falha ao carregar autenticação'))
            .finally(() => setLoadingConfig(false));
    }, []);

    useEffect(() => {
        if (!isLoading && user) {
            const destination = targetAfterLogin ?? getDefaultRouteForRole(user.role);
            navigate(destination, { replace: true });
        }
    }, [isLoading, navigate, targetAfterLogin, user]);

    useEffect(() => {
        if (!config.googleEnabled || !config.googleClientId || !googleButtonRef.current) return;

        let cancelled = false;

        loadGoogleScript()
            .then(() => {
                if (cancelled || !googleButtonRef.current) return;

                const google = (window as any).google;
                if (!google?.accounts?.id) throw new Error('SDK do Google não ficou disponível no navegador.');

                if (googleInitializedClientIdRef.current !== config.googleClientId) {
                    google.accounts.id.initialize({
                        client_id: config.googleClientId,
                        callback: async (response: GoogleCredentialResponse) => {
                            if (!response.credential) {
                                setError('O Google não retornou credencial válida.');
                                return;
                            }

                            setError('');
                            setGoogleLoading(true);
                            try {
                                const loggedUser = await loginWithGoogle(response.credential);
                                navigate(targetAfterLogin ?? getDefaultRouteForRole(loggedUser.role), { replace: true });
                            } catch (err) {
                                setError(err instanceof Error ? err.message : 'Falha ao autenticar com Google.');
                            } finally {
                                setGoogleLoading(false);
                            }
                        },
                        auto_select: false,
                        cancel_on_tap_outside: true,
                        use_fedcm_for_prompt: true,
                    });
                    googleInitializedClientIdRef.current = config.googleClientId;
                }

                googleButtonRef.current.innerHTML = '';
                google.accounts.id.renderButton(googleButtonRef.current, {
                    theme: 'outline',
                    size: 'large',
                    shape: 'pill',
                    text: 'continue_with',
                    logo_alignment: 'left',
                    width: Math.min(360, Math.max(280, googleButtonRef.current.clientWidth || 320)),
                });
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Falha ao carregar login Google.');
            });

        return () => {
            cancelled = true;
        };
    }, [config.googleClientId, config.googleEnabled, loginWithGoogle, navigate, targetAfterLogin]);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const loggedUser = await login(email, password);
            navigate(targetAfterLogin ?? getDefaultRouteForRole(loggedUser.role), { replace: true });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Credenciais inválidas. Tente novamente.');
        } finally {
            setLoading(false);
        }
    }

    const registerHref = targetAfterLogin ? `/register?next=${encodeURIComponent(targetAfterLogin)}` : '/register';

    return (
        <div className={styles.page}>
            <div className={styles.card}>
                <div className={styles.cardHero}>
                    {FOOD_PHOTOS.map((photo) => (
                        <div key={photo.alt} className={styles.heroCell}>
                            <img src={photo.src} alt={photo.alt} className={styles.heroCellImg} />
                        </div>
                    ))}
                    <div className={styles.heroOverlay} aria-hidden="true" />
                    <Link to="/" className={styles.mobileBack}>
                        <ChevronLeft size={18} />
                        <span>Voltar</span>
                    </Link>
                </div>

                <div className={styles.cardBody}>
                    <div className={styles.formHead}>
                        <h1 className={styles.formTitle}>
                            Entrar na Cantina<span className={styles.dot}>.</span>
                        </h1>
                        <p className={styles.formSub}>Use Google ou entre com e-mail e senha.</p>
                    </div>

                     <div className={styles.googleButtonWrap}>
                            <div ref={googleButtonRef} />
                        </div>
                        {loadingConfig && <p className={styles.inlineHint}>Carregando autenticação do Google...</p>}
                        {!loadingConfig && !config.googleEnabled && (
                            <p className={styles.inlineHint}>O login com Google ainda não foi configurado neste ambiente.</p>
                        )}
                        {googleLoading && <p className={styles.inlineHint}>Validando sua conta Google...</p>}
                 

                    <section className={styles.internalSection}>
                        <div className={styles.sectionBadgeMuted}>E-mail e senha</div>

                        <form onSubmit={handleSubmit} className={styles.form} noValidate>
                            <div className={styles.field}>
                                <label htmlFor="email" className={styles.label}>E-mail</label>
                                <input
                                    id="email"
                                    type="email"
                                    className={styles.input}
                                    placeholder="seu@email.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value.toLowerCase())}
                                    required
                                    autoComplete="email"
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck={false}
                                />
                            </div>

                            <div className={styles.field}>
                                <label htmlFor="password" className={styles.label}>Senha</label>
                                <div className={styles.passwordWrapper}>
                                    <input
                                        id="password"
                                        type={showPassword ? 'text' : 'password'}
                                        className={styles.input}
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        autoComplete="current-password"
                                    />
                                    <button
                                        type="button"
                                        className={styles.eyeBtn}
                                        onClick={() => setShowPassword((v) => !v)}
                                        aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>

                            <button type="submit" className={styles.button} disabled={loading}>
                                {loading
                                    ? <span className={styles.spinner} />
                                    : <><span>Entrar</span><ArrowRight size={18} /></>
                                }
                            </button>
                        </form>
                    </section>

                    {error && <div className={styles.error} role="alert">{error}</div>}

                    <div className={styles.footer}>
                        <p className={styles.registerHint}>
                            Não tem conta? <Link to={registerHref} className={styles.registerLink}>Criar conta grátis</Link>
                        </p>
                        <Link to="/" className={styles.backLink}>
                            <ChevronLeft size={15} />
                            <span>Ver cardápio</span>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
