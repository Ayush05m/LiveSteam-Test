// Environment configuration for the frontend
// Vite exposes environment variables with VITE_ prefix via import.meta.env

export const config = {
  // API Server URL - for REST API calls
  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  
  // Socket.IO server URL - for real-time communication
  socketUrl: import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001',
  
  // Stream URL base path - where HLS streams are served
  streamUrl: import.meta.env.VITE_STREAM_URL || 'http://localhost:3001/streams',
};

// Helper to build stream URLs
export const getStreamUrl = (streamKey: string, codec: 'h264' | 'h265' = 'h264') => {
  return `${config.streamUrl}/${streamKey}_${codec}.m3u8`;
};

// Helper to build API endpoints
export const getApiUrl = (path: string) => {
  const baseUrl = config.apiUrl.replace(/\/$/, ''); // Remove trailing slash
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${cleanPath}`;
};

export default config;
