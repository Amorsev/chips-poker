import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/**
 * One socket per browser session; reconnecting is handled by Socket.IO.
 * Auth is passed in the handshake and re-sent automatically on reconnect.
 */
export function getSocket(token: string): Socket {
  const url = (import.meta.env.VITE_SOCKET_URL as string | undefined) || undefined;
  if (!socket) {
    socket = io(url, {
      autoConnect: false,
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 12,
      reconnectionDelay: 700
    });
  } else {
    socket.auth = { token };
  }
  if (!socket.connected) socket.connect();
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
