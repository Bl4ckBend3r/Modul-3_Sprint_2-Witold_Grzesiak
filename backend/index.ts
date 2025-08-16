import { createServer } from 'http';

const PORT = 3000;
const server = createServer(async (req, res) => {
  res.end(JSON.stringify({ status: 'ok'}))

  // 1. Obsługa endpointów
  // 2. Proste serwowanie plików statycznych z katalogu frontend (np. pod ścieżką /static/)
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
