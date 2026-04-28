import { GoogleGenerativeAI } from "@google/generative-ai";
import { create, insert, search } from '@orama/orama';

export class RAGEngine {
    constructor(apiKey, provider = 'gemini', backendMode = 'browser') {
        this.provider = provider;
        this.apiKey = apiKey;
        this.backendMode = backendMode; // 'browser', 'springboot', 'nodejs', 'python'
        this.springbootUrl = "http://localhost:8080/api/rag";
        this.nodejsUrl = "http://localhost:3000/api/rag";
        this.pythonUrl = "http://localhost:8000/api/rag";
        this.genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
        this.model = null; 
        this.chatModelName = ""; 
        this.embedModelName = ""; 
        this.chunks = [];
        this.embeddings = [];
        this.topics = [];
        this.interactions = new Set();
        this.chatHistory = [];
        this.orama = null; // Orama Search Engine
        this.ollamaUrl = "http://localhost:11434";
        this.localModelName = "gemma2b"; // Default to gemma2b as requested
        this.potentialChatModels = [
            "gemini-1.5-flash",
            "models/gemini-1.5-flash",
            "models/gemini-1.5-flash-latest",
            "gemini-1.5-pro",
            "models/gemini-1.5-pro",
            "gemini-pro",
            "models/gemini-pro"
        ];
        this.potentialEmbedModels = [
            "models/text-embedding-004",
            "models/gemini-embedding-001",
            "models/text-multilingual-embedding-002",
            "models/embedding-001"
        ];
    }

    async listAvailableModels() {
        try {
            // 1. If provider is Ollama, prioritize local models
            if (this.provider === 'ollama') {
                // Try direct fetch from browser first (standard Ollama port)
                try {
                    const response = await fetch(`${this.ollamaUrl}/api/tags`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.models && data.models.length > 0) return data.models;
                    }
                } catch (e) {
                    console.warn("Direct Ollama fetch failed, checking backend for local models...");
                }

                // If direct fetch fails and we have a backend, try to let the backend discover local models
                if (this.backendMode !== 'browser') {
                    // Note: This requires the backend to have an endpoint that lists local models
                    // For now, we'll return a helpful 'Pulling...' message or common local defaults
                }

                return [
                    { name: "gemma2:2b", displayName: "Gemma 2 (2B)" },
                    { name: "llama3", displayName: "Llama 3" },
                    { name: "mistral", displayName: "Mistral" }
                ];
            }

            // 2. REMOTE BACKEND Mode (Non-Ollama)
            if (this.backendMode !== 'browser') {
                const urlMap = {
                    'springboot': `${this.springbootUrl}/models`,
                    'nodejs': `${this.nodejsUrl}/models`,
                    'python': `${this.pythonUrl}/models`
                };
                try {
                    const headers = {};
                    if (this.apiKey) headers['x-api-key'] = this.apiKey;
                    
                    const response = await fetch(urlMap[this.backendMode], { headers });
                    if (response.ok) {
                        const data = await response.json();
                        if (data && data.length > 0) return data;
                    }
                } catch (e) {
                    console.warn(`Failed to fetch models from ${this.backendMode} backend`);
                }
            }

            // 3. BROWSER/DIRECT Mode (Gemini)
            const fallbacks = [
                { name: "models/gemini-1.5-flash", displayName: "Gemini 1.5 Flash" },
                { name: "models/gemini-1.5-pro", displayName: "Gemini 1.5 Pro" }
            ];

            if (this.apiKey && this.apiKey !== 'null') {
                try {
                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`);
                    const data = await response.json();
                    if (data.models) return data.models;
                } catch (e) {
                    console.warn("Failed to fetch from Gemini API");
                }
            }
            return fallbacks;
        } catch (e) {
            console.error("Model discovery error:", e);
            return [];
        }
    }

    async findWorkingModels() {
        if (this.provider === 'ollama') {
            console.log("Starting local model discovery...");
            try {
                const availableModels = await this.listAvailableModels();
                const availableNames = availableModels.map(m => m.name);
                console.log("Available local models:", availableNames);
                
                // Look for gemma, then llama, then mistral, then anything
                const bestModel = availableNames.find(n => n.includes('gemma')) 
                               || availableNames.find(n => n.includes('llama'))
                               || availableNames.find(n => n.includes('mistral'))
                               || (availableNames.length > 0 ? availableNames[0] : null);
                
                if (bestModel) {
                    this.localModelName = bestModel;
                    this.chatModelName = bestModel;
                    this.embedModelName = bestModel;
                    console.log(`Successfully found local model: ${bestModel}`);
                    return;
                } else {
                    throw new Error("No models found. Please run 'ollama pull gemma:2b'");
                }
            } catch (err) {
                console.error("Local discovery error:", err);
                throw new Error("Cannot reach Ollama. Is it running with OLLAMA_ORIGINS='*'? (" + err.message + ")");
            }
        }

        console.log("Starting deep model discovery...");
        const availableModels = await this.listAvailableModels();
        const availableNames = availableModels.map(m => m.name);
        console.log("Model names from API:", availableNames);

        // Find Embedding Model
        let embedFound = false;
        // Try detected models first
        const embedCandidates = [
            ...availableNames.filter(n => n.includes('embed')),
            ...this.potentialEmbedModels
        ];

        for (const modelName of embedCandidates) {
            try {
                const testModel = this.genAI.getGenerativeModel({ model: modelName });
                await testModel.embedContent("test");
                this.embedModelName = modelName;
                console.log(`Successfully found working embedding model: ${modelName}`);
                embedFound = true;
                break;
            } catch (e) {
                // Ignore
            }
        }

        // Find Chat Model
        let chatFound = false;
        const chatCandidates = [
            ...availableNames.filter(n => n.includes('flash') || n.includes('pro')),
            ...this.potentialChatModels
        ];

        for (const modelName of chatCandidates) {
            try {
                const testModel = this.genAI.getGenerativeModel({ model: modelName });
                await testModel.generateContent("hi");
                this.chatModelName = modelName;
                this.model = testModel;
                console.log(`Successfully found working chat model: ${modelName}`);
                chatFound = true;
                break;
            } catch (e) {
                // Ignore
            }
        }

        if (!embedFound || !chatFound) {
            const debugInfo = availableNames.length > 0 
                ? `Available: ${availableNames.slice(0, 5).join(', ')}...`
                : "No models returned by API.";
            throw new Error(`Model discovery failed. ${debugInfo}`);
        }
    }

    async switchToFlash() {
        console.warn("Rate limit hit or error encountered. Switching to local Gemma 3 1B for high-speed fallback...");
        // Use local Gemma 3 1B via Ollama as the fallback
        this.provider = 'ollama';
        this.localModelName = "gemma3:1b";
        this.chatModelName = "gemma3:1b";
        this.embedModelName = "gemma3:1b"; // Use same model for embeddings if available
        return true;
    }

    async ensureModelReady() {
        if (this.provider === 'gemini' && !this.model) {
            if (this.chatModelName) {
                this.model = this.genAI.getGenerativeModel({ model: this.chatModelName });
            } else {
                await this.findWorkingModels();
            }
        }
    }

    setSelectedModel(modelName) {
        if (!modelName) {
            console.warn("Attempted to set an empty model name. Ignoring.");
            return;
        }
        
        console.log(`Setting active model to: ${modelName}`);
        if (this.provider === 'ollama') {
            this.localModelName = modelName;
            this.chatModelName = modelName;
            this.embedModelName = modelName;
        } else if (this.genAI) {
            this.chatModelName = modelName;
            this.model = this.genAI.getGenerativeModel({ model: modelName });
        }
    }

    async processChunks(chunks, rawFile = null) {
        if (this.backendMode !== 'browser' && rawFile) {
            console.log(`Uploading file to ${this.backendMode} backend...`);
            const formData = new FormData();
            formData.append('file', rawFile);
            
            const urlMap = {
                'springboot': `${this.springbootUrl}/upload`,
                'nodejs': `${this.nodejsUrl}/upload`,
                'python': `${this.pythonUrl}/upload`
            };
            const url = urlMap[this.backendMode];
            try {
                const headers = {};
                if (this.apiKey) headers['x-api-key'] = this.apiKey;
                
                const response = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: formData
                });
                if (!response.ok) throw new Error(`Backend upload failed: ${response.statusText}`);
                const data = await response.json();
                if (data.status === 'error' || data.detail) throw new Error(data.message || data.detail);
            } catch (e) {
                throw new Error(`Failed to reach the ${this.backendMode} backend at ${url}. Ensure the server is running on the correct port.`);
            }
            
            this.chunks = chunks; // Keep local copy for UI topics if needed
            return;
        }

        this.chunks = chunks;
        this.embeddings = [];
        
        // Only run automatic discovery if no model is selected yet
        if (!this.chatModelName || !this.embedModelName) {
            await this.findWorkingModels();
        }

        if (this.provider === 'ollama') {
            for (const chunk of chunks) {
                try {
                    const response = await fetch(`${this.ollamaUrl}/api/embeddings`, {
                        method: 'POST',
                        body: JSON.stringify({ model: this.embedModelName, prompt: chunk })
                    });
                    if (!response.ok) throw new Error(`Ollama embedding failed: ${response.statusText}`);
                    const data = await response.json();
                    this.embeddings.push(data.embedding);
                } catch (e) {
                    throw new Error(`Cannot reach Ollama at ${this.ollamaUrl}. Please ensure Ollama is running and OLLAMA_ORIGINS="*" is set.`);
                }
            }
        } else {
            const embedModel = this.genAI.getGenerativeModel({ model: this.embedModelName });
            for (const chunk of chunks) {
                const result = await embedModel.embedContent(chunk);
                this.embeddings.push(result.embedding.values);
            }
        }

        // 3. Initialize Orama with dynamic vector size
        const vectorSize = this.embeddings.length > 0 ? this.embeddings[0].length : 1536;
        console.log(`Initializing Orama with vector size: ${vectorSize}`);
        
        this.orama = await create({
            schema: {
                text: 'string',
                embedding: `vector[${vectorSize}]`
            }
        });

        for (let i = 0; i < chunks.length; i++) {
            await insert(this.orama, {
                text: chunks[i],
                embedding: this.embeddings[i]
            });
        }
        
        console.log("Orama Search Engine initialized with " + chunks.length + " chunks");

        await this.identifyTopics();
    }

    async identifyTopics() {
        await this.ensureModelReady();
        
        const prompt = `Identify 5 core concepts from this text. Return them ONLY as a JSON array of strings. 
        Text: ${this.chunks.slice(0, 5).join('\n')}`;
        
        try {
            let text = "";
            if (this.provider === 'ollama') {
                const response = await fetch(`${this.ollamaUrl}/api/generate`, {
                    method: 'POST',
                    body: JSON.stringify({ model: this.localModelName, prompt, stream: false, format: 'json' })
                });
                const data = await response.json();
                text = data.response;
            } else {
                const result = await this.model.generateContent(prompt);
                text = result.response.text();
            }

            text = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const match = text.match(/\[.*\]/s);
            this.topics = match ? JSON.parse(match[0]) : [];
        } catch (e) {
            console.error("Failed to identify topics", e);
            this.topics = ["Overview", "Key Concepts", "Detailed Analysis"];
        }
    }

    async query(userQuery) {
        if (this.backendMode !== 'browser') {
            const modelParam = this.chatModelName ? `&model=${encodeURIComponent(this.chatModelName)}` : "";
            const urlMap = {
                'springboot': `${this.springbootUrl}/ask?question=${encodeURIComponent(userQuery)}${modelParam}`,
                'nodejs': `${this.nodejsUrl}/ask?question=${encodeURIComponent(userQuery)}${modelParam}`,
                'python': `${this.pythonUrl}/ask?question=${encodeURIComponent(userQuery)}${modelParam}`
            };
            
            const headers = {};
            if (this.apiKey) headers['x-api-key'] = this.apiKey;

            const response = await fetch(urlMap[this.backendMode], {
                headers: headers
            });
            const data = await response.json();
            if (data.detail) throw new Error(data.detail);
            return data.answer;
        }

        await this.ensureModelReady();
        
        // 1. Embed query
        let queryEmbedding = [];
        if (this.provider === 'ollama') {
            const response = await fetch(`${this.ollamaUrl}/api/embeddings`, {
                method: 'POST',
                body: JSON.stringify({ model: this.embedModelName, prompt: userQuery })
            });
            const data = await response.json();
            queryEmbedding = data.embedding;
        } else {
            const embedModel = this.genAI.getGenerativeModel({ model: this.embedModelName });
            const queryResult = await embedModel.embedContent(userQuery);
            queryEmbedding = queryResult.embedding.values;
        }

        // 2. Find similar chunks
        // 2. Find similar chunks using Orama
        const searchResult = await search(this.orama, {
            mode: 'vector',
            vector: {
                value: queryEmbedding,
                property: 'embedding'
            },
            limit: 3
        });

        const context = searchResult.hits.map(hit => hit.document.text).join('\n---\n');

        // 3. Prepare History for Context
        const historyContext = this.chatHistory.slice(-6).map(h => 
            `${h.role === 'user' ? 'Child' : 'Teacher'}: ${h.text}`
        ).join('\n');

        // 4. Generate response
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

Context from document:
${context}`;

        const prompt = `${systemPrompt}\n\nRecent Conversation:\n${historyContext}\n\nStudent Question: ${userQuery}`;

        let responseText = "";
        try {
            if (this.provider === 'ollama') {
                const response = await fetch(`${this.ollamaUrl}/api/generate`, {
                    method: 'POST',
                    body: JSON.stringify({ 
                        model: this.localModelName, 
                        prompt, 
                        stream: false,
                        options: { num_ctx: 8192 }
                    })
                });
                const data = await response.json();
                responseText = data.response;
            } else {
                try {
                    const chatResult = await this.model.generateContent(prompt);
                    responseText = chatResult.response.text();
                } catch (e) {
                    if (e.message.includes('429') || e.message.includes('quota')) {
                        await this.switchToFlash();
                        const chatResult = await this.model.generateContent(prompt);
                        responseText = chatResult.response.text();
                    } else {
                        throw e;
                    }
                }
            }
            
            // Save to history
            this.chatHistory.push({ role: 'user', text: userQuery });
            this.chatHistory.push({ role: 'model', text: responseText });
            
            this.updateLaggingMetrics(userQuery, responseText);
            return responseText;
        } catch (error) {
            console.error("Query failed:", error);
            throw error;
        }
    }

    async generateSummary() {
        await this.ensureModelReady();
        
        const context = this.chunks.slice(0, 15).join('\n---\n');
        const prompt = `You are an expert International Teacher. Summarize this document for a Grade 8 student using proven educational techniques.
        
        For EVERY key point, you MUST:
        1. Explain the core concept with logical clarity.
        2. Create a "Universal Mnemonic" (proven to work for long-term memory).
        3. Provide a "Clear Analogy" that is easy for any student to understand.
        
        Format:
        - Big Idea Intro.
        - Concept Title
        - The Logic: ...
        - Mnemonic: ...
        - Analogy: ...
        
        Document Content:
        ${context}`;

        try {
            if (this.provider === 'ollama') {
                console.log(`Generating local summary using: ${this.localModelName}`);
                const response = await fetch(`${this.ollamaUrl}/api/generate`, {
                    method: 'POST',
                    body: JSON.stringify({ 
                        model: this.localModelName, 
                        prompt: prompt, 
                        stream: false,
                        options: { num_ctx: 8192 }
                    })
                });
                
                if (!response.ok) throw new Error(`Ollama error: ${response.statusText}`);
                
                const data = await response.json();
                console.log("Ollama summary response received:", !!data.response);
                return data.response || "Ollama returned an empty response. Try a different model.";
            } else {
                try {
                    const result = await this.model.generateContent(prompt);
                    return result.response.text();
                } catch (e) {
                    if (e.message.includes('429') || e.message.includes('quota')) {
                        await this.switchToFlash();
                        const result = await this.model.generateContent(prompt);
                        return result.response.text();
                    } else {
                        throw e;
                    }
                }
            }
        } catch (error) {
            console.error("Summary generation failed:", error);
            throw new Error("Could not generate summary: " + error.message);
        }
    }

    cosineSimilarity(vecA, vecB) {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    async generateTrickyQuestions() {
        await this.ensureModelReady();
        console.log("Local Mentor: Generating tricky questions...");
        const prompt = `Create 3 multiple-choice questions about this text. 
        Each must have 4 options and a correctIndex (0-3).
        Return ONLY valid JSON array: [{"question": "...", "options": ["...", "..."], "correctIndex": 0}]
        
        Text: ${this.chunks.slice(0, 5).join('\n')}`;
        
        try {
            let text = "";
            if (this.provider === 'ollama') {
                const response = await fetch(`${this.ollamaUrl}/api/generate`, {
                    method: 'POST',
                    body: JSON.stringify({ model: this.localModelName, prompt, stream: false, format: 'json' })
                });
                if (!response.ok) throw new Error("Ollama connection failed");
                const data = await response.json();
                text = data.response;
                console.log("Local Mentor: Received response from Gemma");
            } else {
                const result = await this.model.generateContent(prompt);
                text = result.response.text();
            }
            
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const match = text.match(/\[.*\]/s);
            return match ? JSON.parse(match[0]) : [];
        } catch (e) {
            console.error("Local Mentor Error:", e);
            return [];
        }
    }

    async generateSummary() {
        try {
            if (!this.model && this.provider === 'gemini') await this.findWorkingModels();
            
            const prompt = `You are a brilliant Indian teacher. Summarize this document for a 10-year-old child. 
            For EVERY key point, provide a "Real-World India" example (e.g., relate it to Cricket, Indian street food, festivals like Diwali, or famous Indian places/people) to help the child never forget the concept.
            
            Format: 
            1. A catchy "Big Idea" intro.
            2. Bullet points with "Concept" followed by "India Example 🇮🇳".
            
            Content: ${this.chunks.slice(0, 15).join('\n')}`; // Increased context
            
            if (this.provider === 'ollama') {
                const response = await fetch(`${this.ollamaUrl}/api/generate`, {
                    method: 'POST',
                    body: JSON.stringify({ model: this.localModelName, prompt, stream: false })
                });
                const data = await response.json();
                return data.response;
            } else {
                // Use relaxed safety settings for educational summaries
                const result = await this.model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: { maxOutputTokens: 1000 },
                    safetySettings: [
                        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
                    ]
                });
                return result.response.text();
            }
        } catch (e) {
            console.error("Summary error:", e);
            if (e.message.includes('403') || e.message.includes('API_KEY_INVALID')) {
                return "Teacher's Note: Your API Key seems to have a problem. Please re-check it in the sidebar!";
            }
            return "Teacher's Note: I'm having a little trouble reading this part. Can you try clicking 'View Summary' again? (" + e.message + ")";
        }
    }

    updateLaggingMetrics(query, response) {
        // Simple logic: if a topic name appears in the query or response, mark it as "touched"
        this.topics.forEach(topic => {
            if (query.toLowerCase().includes(topic.toLowerCase()) || 
                response.toLowerCase().includes(topic.toLowerCase())) {
                this.interactions.add(topic);
            }
        });
    }

    getInsights() {
        return this.topics.map(topic => ({
            name: topic,
            mastery: this.interactions.has(topic) ? 100 : 0,
            isLagging: !this.interactions.has(topic)
        }));
    }
}
