import express from 'express';
import multer from 'multer';
import pdf from 'pdf-parse';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
let vectorStore = []; // Simple in-memory store for demo

app.get('/api/rag/models', async (req, res) => {
    const apiKey = req.headers['x-api-key'] || process.env.GOOGLE_API_KEY;
    if (!apiKey) return res.status(401).json({ status: 'error', message: 'API Key missing' });
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();
        res.json(data.models || []);
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/api/rag/upload', upload.single('file'), async (req, res) => {
    const apiKey = req.headers['x-api-key'] || process.env.GOOGLE_API_KEY;
    if (!apiKey) return res.status(401).json({ status: 'error', message: 'API Key missing' });

    try {
        const data = await pdf(req.file.buffer);
        const text = data.text;
        
        // Simple chunking
        const chunks = text.match(/.{1,1000}/g) || [];
        vectorStore = chunks.map((content, id) => ({ id, content }));
        
        res.json({ status: 'success', message: `Indexed ${chunks.length} chunks` });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.get('/api/rag/ask', async (req, res) => {
    const { question, model: modelName } = req.query;
    const selectedModel = modelName || "gemini-1.5-flash";
    const isOllama = !selectedModel.startsWith('models/');
    
    const keywords = question.toLowerCase().split(' ').filter(w => w.length > 3);
    const context = vectorStore
        .filter(chunk => {
            const content = chunk.content.toLowerCase();
            return keywords.some(key => content.includes(key));
        })
        .slice(0, 5)
        .map(c => c.content)
        .join('\n---\n');

    const systemPrompt = `Role: You are a patient and experienced school teacher. Your goal is to explain the provided text to a student aged 10-15.

Instructional Method:
1. The Introduction: Start by telling the student what this document is about using a simple comparison to something familiar (like a kitchen, a library, or a garden).
2. Step-by-Step Breakdown: Take the complex parts and break them into 3-4 small "chapters" or bullet points. Use simple words.
3. The "Kitchen Table" Example: Provide one clear, real-life example of how this concept works using items you’d find at home or school (e.g., "Imagine you are organizing your bookshelf..." or "Think of this like a recipe for a cake...").
4. Check for Understanding: End by asking the student one question to see if they understood the main point.

Rules:
- No technical jargon. If a difficult word must be used, explain it immediately in brackets.
- Use a supportive, "you can do this" tone.
- Keep sentences short.

Context: ${context}`;

    const prompt = `${systemPrompt}\n\nStudent Question: ${question}`;

    try {
        if (isOllama) {
            // Call local Ollama
            const response = await fetch('http://localhost:11434/api/generate', {
                method: 'POST',
                body: JSON.stringify({
                    model: selectedModel,
                    prompt: prompt,
                    stream: false
                })
            });
            const data = await response.json();
            res.json({ answer: data.response });
        } else {
            // Call Google Gemini
            const apiKey = req.headers['x-api-key'] || process.env.GOOGLE_API_KEY;
            if (!apiKey) return res.status(401).json({ status: 'error', message: 'API Key missing' });
            
            const dynamicGenAI = new GoogleGenerativeAI(apiKey);
            const model = dynamicGenAI.getGenerativeModel({ model: selectedModel });
            const result = await model.generateContent(prompt);
            const response = await result.response;
            res.json({ answer: response.text() });
        }
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Node.js Backend running on http://localhost:${PORT}`));
