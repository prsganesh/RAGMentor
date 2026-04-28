import os
import shutil
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import re

# Load environment variables
load_dotenv()

app = FastAPI(
    title="RAG Mentor API",
    description="Python Backend for the RAG Mentor Project",
    version="1.3.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store to match Node.js behavior
# Format: [{"id": 0, "content": "..."}]
vector_store = []

class HealthResponse(BaseModel):
    status: str
    message: str
    version: str

class AskResponse(BaseModel):
    answer: str

@app.get("/", response_model=HealthResponse)
async def root():
    return {
        "status": "online",
        "message": "RAG Mentor Python Backend is running (Keyword Search Mode)",
        "version": "1.3.0"
    }

@app.get("/api/rag/models")
async def list_models(x_api_key: Optional[str] = Header(None)):
    """
    List available models from Google using the provided or environment API key.
    """
    try:
        api_key = x_api_key or os.getenv("GOOGLE_API_KEY")
        if not api_key:
            return []
        
        import httpx
        async with httpx.AsyncClient() as client:
            response = await client.get(f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}")
            data = response.json()
            return data.get("models", [])
    except Exception as e:
        return []

@app.post("/api/rag/upload")
async def upload_pdf(file: UploadFile = File(...), x_api_key: Optional[str] = Header(None)):
    """
    Upload a PDF, extract text, and chunk it (Node.js style).
    """
    try:
        import pypdf
        from io import BytesIO
        
        content = await file.read()
        pdf_reader = pypdf.PdfReader(BytesIO(content))
        text = ""
        for page in pdf_reader.pages:
            text += (page.extract_text() or "") + "\n"
        
        # Simple chunking (1000 characters) to match Node.js behavior
        chunks = [text[i:i+1000] for i in range(0, len(text), 1000)]
        
        global vector_store
        vector_store = [{"id": i, "content": chunk} for i, chunk in enumerate(chunks)]
        
        return {
            "status": "success", 
            "message": f"PDF Indexed: {len(chunks)} chunks stored in memory"
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/rag/ask", response_model=AskResponse)
async def ask(
    question: str = Query(..., description="The question to ask based on the context"),
    model: Optional[str] = Query(None, description="The model to use"),
    x_api_key: Optional[str] = Header(None)
):
    """
    Ask a question using simple keyword matching and the Teacher Persona.
    """
    try:
        selected_model = model or "gemini-1.5-flash"
        is_ollama = not selected_model.startswith("models/")
        api_key = x_api_key or os.getenv("GOOGLE_API_KEY")

        # 1. Keyword-based Retrieval (Matching Node.js logic)
        keywords = [w.lower() for w in question.split() if len(w) > 3]
        matched_chunks = []
        for chunk in vector_store:
            content_lower = chunk["content"].lower()
            if any(key in content_lower for key in keywords):
                matched_chunks.append(chunk["content"])
        
        context = "\n---\n".join(matched_chunks[:5])

        # 2. Teacher Persona Prompt
        system_prompt = f"""Role: You are a patient and experienced school teacher. Your goal is to explain the provided text to a student aged 10-15.

Instructional Method:
1. The Introduction: Start by telling the student what this document is about using a simple comparison to something familiar (like a kitchen, a library, or a garden).
2. Step-by-Step Breakdown: Take the complex parts and break them into 3-4 small "chapters" or bullet points. Use simple words.
3. The "Kitchen Table" Example: Provide one clear, real-life example of how this concept works using items you’d find at home or school (e.g., "Imagine you are organizing your bookshelf..." or "Think of this like a recipe for a cake...").
4. Check for Understanding: End by asking the student one question to see if they understood the main point.

Rules:
- No technical jargon. If a difficult word must be used, explain it immediately in brackets.
- Use a supportive, "you can do this" tone.
- Keep sentences short.

Context: {context}"""

        prompt = f"{system_prompt}\n\nStudent Question: {question}"

        # 3. LLM Call
        if is_ollama:
            import httpx
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "http://localhost:11434/api/generate",
                    json={"model": selected_model, "prompt": prompt, "stream": False},
                    timeout=60.0
                )
                data = response.json()
                answer = data.get("response", "No response from Ollama")
        else:
            if not api_key:
                raise HTTPException(status_code=401, detail="Google API Key missing")
            
            import google.generativeai as genai
            genai.configure(api_key=api_key)
            model_instance = genai.GenerativeModel(selected_model)
            response = model_instance.generate_content(prompt)
            answer = response.text
        
        return {"answer": answer}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/rag/clear")
async def clear_index():
    """
    Clear the in-memory store.
    """
    global vector_store
    vector_store = []
    return {"message": "In-memory store cleared"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
