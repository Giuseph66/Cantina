/**
 * Monitor de disponibilidade do servidor.
 *
 * Vive fora do React porque quem detecta a queda é a camada de fetch.
 * Uma falha isolada nunca derruba a UI sozinha: ela apenas dispara uma sonda
 * em /api/v1/health, e só a sonda decide se o servidor está fora.
 */

export type DownReason = 'offline' | 'server';

export type ServerStatus = {
    /** 'up' enquanto a API responde; 'down' após a sonda confirmar a queda. */
    state: 'up' | 'down';
    /** true enquanto uma sonda está em voo. */
    checking: boolean;
    /** Sondas consecutivas que falharam. */
    attempt: number;
    /** Momento (epoch ms) da próxima tentativa automática. */
    nextRetryAt: number | null;
    /** Duração do ciclo de espera atual, para desenhar o progresso. */
    retryDelayMs: number | null;
    /** Momento (epoch ms) em que o servidor caiu. */
    downSince: number | null;
    /** Sem internet no dispositivo ou servidor mudo. */
    reason: DownReason | null;
};

const PROBE_PATH = '/api/v1/health';
const PROBE_TIMEOUT_MS = 8_000;
/** Backoff progressivo: rápido no começo, sem martelar o servidor que voltou a subir. */
const BACKOFF_MS = [3_000, 5_000, 8_000, 13_000, 21_000, 30_000];

let status: ServerStatus = {
    state: 'up',
    checking: false,
    attempt: 0,
    nextRetryAt: null,
    retryDelayMs: null,
    downSince: null,
    reason: null,
};

const listeners = new Set<() => void>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<boolean> | null = null;

function emit(patch: Partial<ServerStatus>) {
    status = { ...status, ...patch };
    listeners.forEach(listener => listener());
}

export function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getServerStatus() {
    return status;
}

/**
 * Sinais que merecem uma sonda. Um 4xx de negócio nunca é queda de servidor;
 * qualquer 5xx é suspeito e vale checar — proxies traduzem a queda de formas
 * diferentes (o dev server do Vite responde 500, a Vercel responde 502).
 * A decisão final é sempre da sonda, então um 500 legítimo da aplicação
 * custa só uma requisição a /health e não derruba a interface.
 */
export function isConnectivityError(error: unknown): boolean {
    if (error instanceof TypeError) return true; // fetch abortado pela rede
    if (error instanceof DOMException && error.name === 'AbortError') return true;
    if (error instanceof Error) {
        const match = /^\[(\d{3})\]/.exec(error.message);
        if (match) return Number(match[1]) >= 500;
        // encrypted-fetch falha antes de ter status quando o canal não sobe
        return /canal criptografado/i.test(error.message) || /failed to fetch/i.test(error.message);
    }
    return false;
}

function clearRetryTimer() {
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
}

function scheduleRetry() {
    clearRetryTimer();
    const delay = BACKOFF_MS[Math.min(status.attempt - 1, BACKOFF_MS.length - 1)] ?? 30_000;
    emit({ nextRetryAt: Date.now() + delay, retryDelayMs: delay });
    retryTimer = setTimeout(() => {
        retryTimer = null;
        void probe();
    }, delay);
}

/** Consulta /health. Resolve true se o servidor está saudável. */
export async function probe(): Promise<boolean> {
    if (inFlight) return inFlight;

    if (!navigator.onLine) {
        markDown('offline');
        return false;
    }

    emit({ checking: true });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    inFlight = (async () => {
        try {
            // fetch nativo de propósito: a sonda não passa pelo canal criptografado.
            const res = await fetch(PROBE_PATH, {
                method: 'GET',
                cache: 'no-store',
                credentials: 'omit',
                headers: { 'ngrok-skip-browser-warning': '1' },
                signal: controller.signal,
            });
            if (!res.ok) throw new Error(`health ${res.status}`);
            const body = await res.json().catch(() => null);
            if (body && body.status !== 'ok') throw new Error(`health ${body.status}`);
            markUp();
            return true;
        } catch {
            markDown('server');
            return false;
        } finally {
            clearTimeout(timeout);
            inFlight = null;
        }
    })();

    return inFlight;
}

function markUp() {
    clearRetryTimer();
    const wasDown = status.state === 'down';
    emit({ state: 'up', checking: false, attempt: 0, nextRetryAt: null, retryDelayMs: null, downSince: null, reason: null });
    if (wasDown) recovered.forEach(listener => listener());
}

function markDown(reason: DownReason) {
    emit({
        state: 'down',
        checking: false,
        attempt: status.attempt + 1,
        downSince: status.downSince ?? Date.now(),
        reason,
    });
    scheduleRetry();
}

/** Chamado pela camada de fetch a cada resposta bem-sucedida. */
export function reportSuccess() {
    if (status.state === 'down' || status.attempt > 0) markUp();
}

/**
 * Classifica uma resposta HTTP e alimenta o monitor.
 * Para quem faz fetch direto, sem passar pelo wrapper de erro do useApi.
 */
export function reportResponse(res: Response) {
    if (res.status >= 500) {
        reportFailure(new Error(`[${res.status}] resposta do servidor`));
        return;
    }
    reportSuccess();
}

/** Chamado pela camada de fetch quando a requisição falha. */
export function reportFailure(error: unknown) {
    if (!isConnectivityError(error)) return;
    if (status.state === 'down' || status.checking) return;
    void probe();
}

/** Tentativa manual disparada pelo botão da tela de espera. */
export function retryNow() {
    clearRetryTimer();
    emit({ nextRetryAt: null, retryDelayMs: null });
    return probe();
}

/** Callbacks disparados quando o servidor volta. */
const recovered = new Set<() => void>();

export function onRecovered(listener: () => void) {
    recovered.add(listener);
    return () => {
        recovered.delete(listener);
    };
}

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        if (status.state === 'down') void retryNow();
    });
    window.addEventListener('offline', () => {
        if (status.state === 'up') markDown('offline');
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && status.state === 'down') void retryNow();
    });
}
