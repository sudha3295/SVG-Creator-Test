import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

app.post('/api/generate-svg', async (req, res) => {
  try {
    const { model, systemPrompt, prompt } = req.body;

    if (!model || !prompt) {
      return res.status(400).json({ error: 'Model and prompt are required.' });
    }

    const config: Record<string, any> = {};
    if (systemPrompt && typeof systemPrompt === 'string' && systemPrompt.trim()) {
      config.systemInstruction = systemPrompt.trim();
    }

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config,
    });

    const rawText = response.text || '';
    const usageMetadata = response.usageMetadata || null;

    return res.json({
      rawText,
      usageMetadata,
    });
  } catch (error: any) {
    console.error('Error generating SVG with model:', error);
    const errorMessage =
      error?.message ||
      (typeof error === 'string' ? error : 'Failed to generate response from Gemini API.');
    return res.status(500).json({ error: errorMessage });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
  });
}

startServer();
