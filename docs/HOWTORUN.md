# How to run NoteWise (command reference)

No explanations here — just the commands. See the root `README.md` for context on any step.

## 1. MongoDB (must be running first)

**Windows**
```powershell
Get-Service MongoDB
Start-Service MongoDB   # if not already running
```

**macOS**
```bash
brew services start mongodb-community
```

**Linux**
```bash
sudo systemctl start mongod
```

Verify:
```bash
mongosh
```

## 2. Environment variables

```bash
cp .env.example .env
```
Edit `.env` and fill in:
```
GEMINI_API_KEY=...
GROQ_API_KEY=...
MONGODB_URI=mongodb://localhost:27017/chat-with-notes
PORT=5000
```

## 3. Backend

```bash
cd backend
npm install
npm run dev
```
Runs at `http://localhost:5000`. Health check:
```bash
curl http://localhost:5000/api/health
```

## 4. Frontend

```bash
cd frontend
npm install
npm run dev
```
Runs at `http://localhost:5173`.

## 5. (Optional) Access from your phone

```bash
# Windows
ipconfig
# macOS/Linux
ifconfig
```
Note your LAN IP (e.g. `192.168.1.23`). Both dev servers already bind to your network. On your phone, browse to the frontend's printed "Network" URL. If the frontend can't reach the backend from the phone, set:
```bash
cd frontend
cp .env.example .env
# edit frontend/.env:
# VITE_API_BASE_URL=http://192.168.1.23:5000/api
npm run dev
```

## 6. Hitting the API directly

**Upload a text file**
```bash
curl -X POST http://localhost:5000/api/documents \
  -F "file=@/path/to/notes.txt"
```

**Upload an image with a specific OCR method**
```bash
curl -X POST http://localhost:5000/api/documents \
  -F "file=@/path/to/photo.jpg" \
  -F "ocrMethod=both"
```

**List documents**
```bash
curl http://localhost:5000/api/documents
```

**View a still-cached original image (kept 24h, or indefinitely if starred)**
```bash
curl http://localhost:5000/api/documents/photo.jpg/image --output photo.jpg
```

**Star an image to keep it past the 24h auto-expiry**
```bash
curl -X PATCH http://localhost:5000/api/documents/photo.jpg/star \
  -H "Content-Type: application/json" \
  -d '{"starred": true}'
```

**Delete a document**
```bash
curl -X DELETE http://localhost:5000/api/documents/notes.txt
```

**Ask a question**
```bash
curl -X POST http://localhost:5000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "What are my notes about?"}'
```

### PowerShell equivalents

```powershell
Invoke-RestMethod -Uri http://localhost:5000/api/documents -Method Post -Form @{ file = Get-Item "C:\path\to\notes.txt" }

Invoke-RestMethod -Uri http://localhost:5000/api/documents -Method Get

Invoke-RestMethod -Uri "http://localhost:5000/api/documents/notes.txt" -Method Delete

Invoke-RestMethod -Uri http://localhost:5000/api/chat -Method Post -ContentType "application/json" -Body '{"question": "What are my notes about?"}'
```

## 7. Stopping everything

Ctrl+C in each terminal running `npm run dev`. MongoDB (installed as a service) keeps running in the background — stop it with:
```powershell
Stop-Service MongoDB        # Windows
```
```bash
brew services stop mongodb-community   # macOS
sudo systemctl stop mongod             # Linux
```
