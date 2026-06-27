import { io, Socket } from 'socket.io-client';
import { getToken } from './auth';
import { getApiRootUrl } from './api';

let socket: Socket | null = null;

export async function getSocket(): Promise<Socket> {
  if (socket && socket.connected) {
    return socket;
  }

  const token = await getToken();
  const rootUrl = getApiRootUrl();

  if (!socket) {
    socket = io(rootUrl, {
      auth: { token },
      autoConnect: false,
      transports: ['websocket'],
    });
  } else {
    socket.auth = { token };
  }

  if (!socket.connected) {
    socket.connect();
  }

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
