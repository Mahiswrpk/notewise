// Thin wrapper around the NoteWise backend REST API.
//
// By default this talks to the backend on the same machine
// (http://localhost:5000/api). If you want to reach NoteWise from your
// phone or another device on the same Wi-Fi network, set VITE_API_BASE_URL
// in frontend/.env to your machine's LAN IP, e.g.
//   VITE_API_BASE_URL=http://192.168.1.23:5000/api
// See the README's "Access NoteWise from your phone" section.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

async function handleResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }
  return data;
}

export async function uploadDocument(file, ocrMethod) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('ocrMethod', ocrMethod);

  const response = await fetch(`${API_BASE_URL}/documents`, {
    method: 'POST',
    body: formData,
  });
  return handleResponse(response);
}

export async function listDocuments() {
  const response = await fetch(`${API_BASE_URL}/documents`);
  return handleResponse(response);
}

export async function deleteDocument(filename) {
  const response = await fetch(`${API_BASE_URL}/documents/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  });
  return handleResponse(response);
}

export async function askQuestion(question) {
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  return handleResponse(response);
}

// Direct <img src> URL for a still-cached original image (see the README's
// image-caching section). The <img> tag itself does the fetching/error
// handling here, not this function - it just builds the URL.
export function getImageUrl(filename) {
  return `${API_BASE_URL}/documents/${encodeURIComponent(filename)}/image`;
}

export async function setImageStarred(filename, starred) {
  const response = await fetch(`${API_BASE_URL}/documents/${encodeURIComponent(filename)}/star`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ starred }),
  });
  return handleResponse(response);
}
