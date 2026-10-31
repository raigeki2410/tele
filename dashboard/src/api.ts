import axios from 'axios';

const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'X-API-Key': process.env.VITE_API_KEY,
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

export const getSystemStatus = () => apiClient.get('/system/status').then(res => res.data);
export const getAccounts = () => apiClient.get('/accounts').then(res => res.data);
export const createAccount = (data: { name: string; token: string; groupId: string; type?: string }) => apiClient.post('/accounts', data).then(res => res.data);
export const deleteAccount = (id: string) => apiClient.delete(`/accounts/${id}`).then(res => res.data);
export const getAccount = (id: string) => apiClient.get(`/accounts/${id}`).then(res => res.data);
export const updateAccount = (id: string, data: unknown) => apiClient.patch(`/accounts/${id}`, data).then(res => res.data);
export const startAccountLogin = (id: string) => apiClient.post(`/accounts/${id}/login`).then(res => res.data);
export const requestAccountReconnect = (id: string) => apiClient.post(`/accounts/${id}/reconnect`).then(res => res.data);
export const restartAccount = (id: string) => apiClient.post(`/accounts/${id}/restart`).then(res => res.data);
export const getMetricHistory = () => apiClient.get('/metrics/history').then(res => res.data);
export const getConversations = () => apiClient.get('/conversations').then(res => res.data);
export const getRoutes = () => apiClient.get('/routes').then(res => res.data);
export const startWorkerProcess = (id: string) => apiClient.post(`/workers/${id}/start`).then(res => res.data);
export const stopWorkerProcess = (id: string) => apiClient.post(`/workers/${id}/stop`).then(res => res.data);
export const restartWorkerProcess = (id: string) => apiClient.post(`/workers/${id}/restart`).then(res => res.data);
export const getLogs = (params?: Record<string, string | number>) => apiClient.get('/logs', { params }).then(res => res.data);
export const getSettings = () => apiClient.get('/settings').then(res => res.data);
export const updateSettings = (settings: unknown, accountId?: string) => apiClient.patch('/settings', { settings, accountId }).then(res => res.data);

export const getReportSettings = () => apiClient.get('/reports/settings').then(res => res.data);
export const updateReportSettings = (settings: unknown) => apiClient.patch('/reports/settings', settings).then(res => res.data);
export const getReportSummary = (params?: Record<string, string | number>) => apiClient.get('/reports/summary', { params }).then(res => res.data);
export const downloadReport = (params?: Record<string, string | number>) => apiClient.get('/reports/download', { params, responseType: 'blob' }).then(res => res.data);
export const getReportInstances = () => apiClient.get('/report-instances').then(res => res.data.instances as string[]);

export default apiClient;