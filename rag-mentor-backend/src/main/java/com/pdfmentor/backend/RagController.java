package com.pdfmentor.backend;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.chat.prompt.PromptTemplate;
import org.springframework.ai.document.Document;
import org.springframework.ai.reader.pdf.PagePdfDocumentReader;
import org.springframework.ai.transformer.splitter.TokenTextSplitter;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.vectorstore.SimpleVectorStore;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.ollama.OllamaChatModel;
import org.springframework.ai.googlegemini.GoogleGeminiChatModel;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.core.io.Resource;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.web.client.RestTemplate;
import org.json.JSONObject;
import org.json.JSONArray;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/rag")
@CrossOrigin(origins = "*")
public class RagController {

    private final VectorStore vectorStore;
    private final ChatModel geminiChatModel;
    private final ChatModel ollamaChatModel;

    @Value("${spring.ai.google.gemini.api-key:}")
    private String defaultApiKey;

    public RagController(VectorStore vectorStore, 
                         @Qualifier("googleGeminiChatModel") ChatModel geminiChatModel,
                         @Qualifier("ollamaChatModel") ChatModel ollamaChatModel) {
        this.vectorStore = vectorStore;
        this.geminiChatModel = geminiChatModel;
        this.ollamaChatModel = ollamaChatModel;
    }

    @GetMapping("/models")
    public List<Map<String, String>> listModels(@RequestHeader(value = "x-api-key", required = false) String apiKey) {
        String key = (apiKey != null && !apiKey.isEmpty()) ? apiKey : defaultApiKey;
        if (key == null || key.isEmpty()) return List.of();

        try {
            String url = "https://generativelanguage.googleapis.com/v1beta/models?key=" + key;
            RestTemplate restTemplate = new RestTemplate();
            String response = restTemplate.getForObject(url, String.class);
            JSONObject json = new JSONObject(response);
            JSONArray modelsArr = json.getJSONArray("models");
            
            List<Map<String, String>> models = new ArrayList<>();
            for (int i = 0; i < modelsArr.length(); i++) {
                JSONObject m = modelsArr.getJSONObject(i);
                models.add(Map.of("name", m.getString("name")));
            }
            return models;
        } catch (Exception e) {
            return List.of();
        }
    }

    @PostMapping("/upload")
    public Map<String, String> uploadPdf(@RequestParam("file") MultipartFile file) {
        try {
            Resource pdfResource = new ByteArrayResource(file.getBytes());
            PagePdfDocumentReader reader = new PagePdfDocumentReader(pdfResource);
            List<Document> documents = reader.get();

            TokenTextSplitter splitter = new TokenTextSplitter();
            List<Document> chunks = splitter.apply(documents);

            vectorStore.add(chunks);
            return Map.of("status", "success", "message", "PDF indexed: " + chunks.size() + " chunks");
        } catch (Exception e) {
            return Map.of("status", "error", "message", e.getMessage());
        }
    }

    @GetMapping("/ask")
    public Map<String, String> ask(
            @RequestParam String question, 
            @RequestParam(required = false) String model,
            @RequestHeader(value = "x-api-key", required = false) String apiKey) {
        
        List<Document> similarDocs = vectorStore.similaritySearch(question);
        String context = similarDocs.stream()
                .map(Document::getContent)
                .collect(Collectors.joining("\n---\n"));

        String teacherPrompt = """
            Role: You are a patient and experienced school teacher. Your goal is to explain the provided text to a student aged 10-15.

            Instructional Method:
            1. The Introduction: Start by telling the student what this document is about using a simple comparison to something familiar (like a kitchen, a library, or a garden).
            2. Step-by-Step Breakdown: Take the complex parts and break them into 3-4 small "chapters" or bullet points. Use simple words.
            3. The "Kitchen Table" Example: Provide one clear, real-life example of how this concept works using items you'd find at home or school (e.g., "Imagine you are organizing your bookshelf..." or "Think of this like a recipe for a cake...").
            4. Check for Understanding: End by asking the student one question to see if they understood the main point.

            Rules:
            - No technical jargon. If a difficult word must be used, explain it immediately in brackets.
            - Use a supportive, "you can do this" tone.
            - Keep sentences short.

            Context from document:
            {context}
            
            Student Question: {question}
            """;

        ChatModel activeModel = (model != null && !model.startsWith("models/")) ? ollamaChatModel : geminiChatModel;
        
        PromptTemplate template = new PromptTemplate(teacherPrompt);
        Prompt prompt = template.create(Map.of("context", context, "question", question));
        
        String answer = activeModel.call(prompt).getResult().getOutput().getContent();

        return Map.of("answer", answer);
    }
    
    @Bean
    public VectorStore vectorStore(EmbeddingModel embeddingModel) {
        return new SimpleVectorStore(embeddingModel);
    }
}
