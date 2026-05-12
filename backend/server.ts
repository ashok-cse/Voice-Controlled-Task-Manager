import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { handle } from './wsHandlers';

interface WsRequest {
  id?: string;
  type: string;
  token?: string;
  payload?: Record<string, unknown>;
}

const PORT = Number(process.env.PORT ?? process.env.BACKEND_PORT ?? 8787);

// In production we serve the built SvelteKit frontend from the same Node
// process so a single port handles both HTTP and the /ws WebSocket.
// In dev this file is missing and Vite proxies /ws to us instead.
let sveltekitHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;
try {
  const mod = await import('../build/handler.js');
  sveltekitHandler = (mod as { handler: typeof sveltekitHandler }).handler ?? null;
  if (sveltekitHandler) console.log('[http] serving SvelteKit build from ./build');
} catch {
  // No build available — fine for dev mode.
}

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (sveltekitHandler) {
    sveltekitHandler(req, res);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('VoiceTask backend OK');
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws', perMessageDeflate: false });

wss.on('connection', (ws: WebSocket) => {
  console.log('[ws] client connected');

  ws.on('message', async (raw: RawData) => {
    let msg: WsRequest | null = null;
    try {
      msg = JSON.parse(raw.toString()) as WsRequest;
    } catch {
      return;
    }
    const id = msg?.id;
    try {
      const data = await handle(msg);
      ws.send(JSON.stringify({ id, ok: true, data }));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error('[ws] handler error:', error);
      ws.send(JSON.stringify({ id, ok: false, error }));
    }
  });

  ws.on('close', () => console.log('[ws] client disconnected'));
});

httpServer.listen(PORT, () => {
  console.log(`[ws] WebSocket backend listening on ws://localhost:${PORT}/ws`);
  if (sveltekitHandler) {
    console.log(`[http] HTTP frontend listening on http://localhost:${PORT}`);
  }
});
