import './style.css'
import { PDFEngine } from './pdf-engine'
import { RAGEngine } from './rag-engine'

const pdfEngine = new PDFEngine();
let ragEngine = null;

// DOM Elements
const apiKeyInput = document.getElementById('api-key');
const saveKeyBtn = document.getElementById('save-key');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const docInfo = document.getElementById('doc-info');
const docName = docInfo.querySelector('.doc-name');
const docStats = docInfo.querySelector('.doc-stats');
const topicsList = document.getElementById('topics-list');
const chatMessages = document.getElementById('chat-messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const inputContainer = document.querySelector('.input-container');
const processingIndicator = document.getElementById('processing-indicator');
const statusText = document.getElementById('status-text');

// Step Elements
const step1 = document.getElementById('step-1');
const step2 = document.getElementById('step-2');
const step3 = document.getElementById('step-3');
const step4 = document.getElementById('step-4');
const analyzeBtn = document.getElementById('analyze-doc-btn');
const analysisStatus = document.getElementById('analysis-status');

// Provider Elements
const providerToggle = document.getElementById('provider-toggle');
const providerLabel = document.getElementById('provider-label');
const apiKeyContainer = document.getElementById('api-key-container');
const modelSelect = document.getElementById('model-select');
const backendModeSelect = document.getElementById('backend-mode');
const aiProviderSection = document.getElementById('ai-provider-section');

// Modal Elements
const challengeModal = document.getElementById('challenge-modal');
const modalChallengesList = document.getElementById('modal-challenges-list');
const closeModalBtn = document.getElementById('close-modal');
const startChatBtn = document.getElementById('start-chat-btn');

// Summary & Quiz Elements
const viewSummaryBtn = document.getElementById('view-summary-btn');
const takeQuizBtn = document.getElementById('take-quiz-btn');
const summaryModal = document.getElementById('summary-modal');
const summaryContent = document.getElementById('summary-content');
const closeSummaryModal = document.getElementById('close-summary-modal');
const closeSummaryBtn = document.getElementById('close-summary-btn');
const summaryScrollBtn = document.getElementById('summary-scroll-btn');

// State
let currentQuiz = [];
let currentQuestionIndex = 0;
let userScore = 0;
let uploadedFile = null;

// Init
const storedKey = sessionStorage.getItem('GEMINI_API_KEY');
if (storedKey) {
    apiKeyInput.value = storedKey;
}
initializeRAG(storedKey || null, 'gemini');

function updateStepUI() {
    if (!ragEngine) return;
    
    const hasDoc = pdfEngine.getChunks().length > 0;
    const isBrowser = backendModeSelect.value === 'browser';
    const isOllama = isBrowser && providerToggle.checked;
    // Key is required ONLY if in Browser mode AND not using Ollama
    const hasKey = !isBrowser || isOllama || (apiKeyInput.value.trim().length > 5);
    const hasModel = modelSelect.value && !modelSelect.value.includes('Scanning');
    const isAnalyzed = ragEngine && ragEngine.chunks.length > 0;

    // Reset states
    [step1, step2, step3, step4].forEach(s => s.classList.remove('active', 'success'));

    // Step 1 logic
    if (hasDoc) {
        step1.classList.add('success');
        step2.classList.remove('disabled');
        step2.classList.add('active');
    } else {
        step1.classList.add('active');
        step2.classList.add('disabled');
        step3.classList.add('disabled');
        step4.classList.add('disabled');
    }

    // Step 2 logic
    if (hasDoc && hasKey && hasModel) {
        step2.classList.add('success');
        step3.classList.remove('disabled');
        step3.classList.add('active');
        analyzeBtn.disabled = false;
        analysisStatus.textContent = "Engine Ready";
        analysisStatus.className = "status-helper success-text";
    } else if (hasDoc) {
        step2.classList.add('active');
        step3.classList.add('disabled');
        analyzeBtn.disabled = true;
        
        if (isBrowser && !isOllama && !hasKey) {
            analysisStatus.textContent = "Awaiting Gemini Key";
        } else if (!hasModel) {
            analysisStatus.textContent = "Loading Models...";
        } else {
            analysisStatus.textContent = "Configure Engine";
        }
    }

    // Step 3 logic
    if (isAnalyzed) {
        step3.classList.add('success');
        step3.classList.remove('active');
        step4.classList.remove('disabled');
        step4.classList.add('active');
        viewSummaryBtn.disabled = false;
        takeQuizBtn.disabled = false;
        
        // Allow re-analysis if they want to change models
        analyzeBtn.textContent = "🔄 Re-inject Intelligence";
        analyzeBtn.disabled = false;
        analyzeBtn.classList.add('success-btn');
    }
}

// Backend Mode Logic
backendModeSelect.addEventListener('change', () => {
    const mode = backendModeSelect.value;
    if (ragEngine) ragEngine.backendMode = mode;
    
    // Always show provider toggle now as requested
    aiProviderSection.classList.remove('hidden');
    
    if (mode === 'browser') {
        addMessage('system', 'Switched to Browser Mode.');
    } else {
        addMessage('system', `Using ${mode} backend. Local/Cloud models both supported.`);
    }

    // Only show API key container if Google Gemini is selected
    if (providerToggle.checked) {
        apiKeyContainer.classList.add('hidden');
    } else {
        apiKeyContainer.classList.remove('hidden');
    }

    refreshModels();
    updateStepUI();
});

// Provider Toggle Logic
providerToggle.addEventListener('change', () => {
    const isLocal = providerToggle.checked;
    if (isLocal) {
        providerLabel.textContent = "Local Ollama";
        apiKeyContainer.classList.add('hidden');
        initializeRAG(null, 'ollama');
    } else {
        providerLabel.textContent = "Google Gemini";
        apiKeyContainer.classList.remove('hidden');
        const key = apiKeyInput.value.trim();
        initializeRAG(key || null, 'gemini');
    }
    refreshModels();
    updateStepUI();
});

// API Key Logic
apiKeyInput.addEventListener('input', () => {
    updateStepUI();
    // If key looks valid, try to refresh models
    if (apiKeyInput.value.trim().length > 20) {
        if (ragEngine) ragEngine.apiKey = apiKeyInput.value.trim();
        refreshModels();
    }
});

saveKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) return;

    try {
        saveKeyBtn.textContent = '...';
        const engine = new RAGEngine(key, 'gemini');
        const models = await engine.listAvailableModels();
        
        if (models && models.length > 0) {
            sessionStorage.setItem('GEMINI_API_KEY', key);
            initializeRAG(key, 'gemini');
            saveKeyBtn.textContent = '✓';
            updateStepUI();
        }
    } catch (error) {
        saveKeyBtn.textContent = '❌';
    } finally {
        setTimeout(() => saveKeyBtn.textContent = '✓', 2000);
        refreshModels();
    }
});

// Analyze Button Logic
analyzeBtn.addEventListener('click', async () => {
    if (!uploadedFile || !ragEngine) return;
    
    try {
        analyzeBtn.disabled = true;
        analyzeBtn.textContent = "⏳ Analyzing...";
        processingIndicator.classList.remove('hidden');
        statusText.textContent = 'Generating Embeddings...';
        
        await ragEngine.processChunks(pdfEngine.getChunks(), uploadedFile);
        
        updateInsights();
        updateStatusWithModel('Analysis Complete');
        analyzeBtn.textContent = "✅ Analyzed";
        updateStepUI();
        addMessage('system', 'Analysis complete! You can now use the Mastery Center or ask doubts.');
    } catch (error) {
        console.error(error);
        addMessage('system', 'Error during analysis: ' + error.message);
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = "🚀 Retry Analysis";
    } finally {
        processingIndicator.classList.add('hidden');
    }
});

async function handleFileUpload(file) {
    try {
        processingIndicator.classList.remove('hidden');
        statusText.textContent = 'Loading PDF...';
        
        const info = await pdfEngine.loadPDF(file);
        uploadedFile = file;
        
        docName.textContent = info.name;
        docStats.textContent = `${info.numPages} pages • ${info.numChunks} chunks`;
        docInfo.classList.remove('hidden');
        dropZone.classList.add('hidden');
        
        statusText.textContent = 'PDF Loaded';
        updateStepUI();
    } catch (error) {
        console.error(error);
        addMessage('system', 'Error loading PDF: ' + error.message);
    } finally {
        processingIndicator.classList.add('hidden');
    }
}

function updateStatusWithModel(baseText) {
    if (ragEngine && ragEngine.chatModelName) {
        const modelLabel = ragEngine.chatModelName.replace('models/', '');
        statusText.innerHTML = `${baseText} <span class="model-badge-mini">${modelLabel}</span>`;
    } else {
        statusText.textContent = baseText;
    }
}

async function refreshModels() {
    if (!ragEngine) return;
    
    const isBrowser = backendModeSelect.value === 'browser';
    const isOllama = isBrowser && providerToggle.checked;
    const hasKey = (apiKeyInput.value.trim().length > 5) || !isBrowser || isOllama;

    // If in browser mode (Gemini) and no key is entered, don't populate yet as requested
    if (isBrowser && !isOllama && !hasKey) {
        modelSelect.innerHTML = '<option value="">Awaiting API Key...</option>';
        modelSelect.disabled = true;
        return;
    }

    try {
        modelSelect.disabled = true;
        modelSelect.innerHTML = '<option>🔍 Scanning models...</option>';
        
        const models = await ragEngine.listAvailableModels();
        
        if (models && models.length > 0) {
            modelSelect.innerHTML = models.map(m => {
                const name = m.name || m;
                const displayName = typeof name === 'string' ? name.replace('models/', '') : name;
                return `<option value="${name}">${displayName}</option>`;
            }).join('');
            
            if (ragEngine.chatModelName) {
                modelSelect.value = ragEngine.chatModelName;
            } else {
                ragEngine.setSelectedModel(modelSelect.value);
            }
        } else {
            throw new Error("No models found");
        }
    } catch (e) {
        console.warn("Model fetch failed:", e);
        if (isBrowser && !isOllama) {
            modelSelect.innerHTML = '<option value="">Invalid Key or No Models Found</option>';
        } else {
            modelSelect.innerHTML = '<option>⚠️ Check Connection</option>';
        }
    } finally {
        modelSelect.disabled = false;
        updateStatusWithModel(statusText.textContent.split('<')[0].trim() || 'Ready');
    }
}

// Model selection logic
modelSelect.addEventListener('change', () => {
    if (ragEngine) {
        const modelName = modelSelect.value;
        ragEngine.setSelectedModel(modelName);
        updateStatusWithModel(`Ready with ${modelName}`);
        updateStepUI();
    }
});

// File Upload Event Listeners
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type === 'application/pdf') {
        handleFileUpload(files[0]);
    }
});
fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFileUpload(e.target.files[0]);
});

function initializeRAG(key, provider = 'gemini') {
    const backendMode = backendModeSelect.value;
    ragEngine = new RAGEngine(key, provider, backendMode);
    refreshModels();
    updateUIState();
    updateStepUI();
}


// Chat Logic
userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = userInput.scrollHeight + 'px';
    updateUIState();
});

sendBtn.addEventListener('click', handleSend);
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
    }
});

async function handleSend() {
    const query = userInput.value.trim();
    if (!query || !ragEngine) return;

    userInput.value = '';
    userInput.style.height = 'auto';
    addMessage('user', query);
    updateUIState();

    try {
        processingIndicator.classList.remove('hidden');
        inputContainer.classList.add('disabled');
        userInput.disabled = true;
        
        const response = await ragEngine.query(query);
        addMessage('bot', response);
        updateInsights();
        updateStatusWithModel('Analysed Content');
    } catch (error) {
        addMessage('system', 'Error: ' + error.message);
    } finally {
        processingIndicator.classList.add('hidden');
        inputContainer.classList.remove('disabled');
        userInput.disabled = false;
        userInput.focus();
        updateUIState();
    }
}

function addMessage(role, content) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    msgDiv.innerHTML = `<div class="message-content">${formatContent(content)}</div>`;
    chatMessages.appendChild(msgDiv);
    scrollToBottom();
}

function scrollToBottom() {
    chatMessages.scrollTo({
        top: chatMessages.scrollHeight,
        behavior: 'smooth'
    });
}

function showChallengeModal(challenges) {
    currentQuiz = challenges;
    currentQuestionIndex = 0;
    userScore = 0;
    renderCurrentQuestion();
    challengeModal.classList.remove('hidden');
}

function renderCurrentQuestion() {
    const q = currentQuiz[currentQuestionIndex];
    if (!q) {
        renderQuizResults();
        return;
    }

    modalChallengesList.innerHTML = `
        <div class="quiz-progress">Question ${currentQuestionIndex + 1} of ${currentQuiz.length}</div>
        <div class="challenge-q">${q.question}</div>
        <div class="options-grid">
            ${q.options.map((opt, i) => `
                <button class="option-btn" data-index="${i}">${opt}</button>
            `).join('')}
        </div>
        <div id="quiz-feedback" class="quiz-feedback hidden"></div>
    `;
    
    startChatBtn.classList.add('hidden'); // Hide until finished

    modalChallengesList.querySelectorAll('.option-btn').forEach(btn => {
        btn.addEventListener('click', (e) => handleOptionSelect(parseInt(e.target.dataset.index)));
    });
}

function handleOptionSelect(selectedIndex) {
    const q = currentQuiz[currentQuestionIndex];
    const feedback = document.getElementById('quiz-feedback');
    const buttons = modalChallengesList.querySelectorAll('.option-btn');
    
    // Disable all buttons
    buttons.forEach(btn => btn.disabled = true);
    
    const isCorrect = selectedIndex === q.correctIndex;
    if (isCorrect) {
        userScore++;
        buttons[selectedIndex].classList.add('correct');
        feedback.textContent = "✨ Correct!";
        feedback.className = "quiz-feedback success";
    } else {
        buttons[selectedIndex].classList.add('wrong');
        buttons[q.correctIndex].classList.add('correct');
        feedback.textContent = "❌ Not quite right.";
        feedback.className = "quiz-feedback error";
    }
    
    feedback.classList.remove('hidden');
    
    // Move to next question after delay
    setTimeout(() => {
        currentQuestionIndex++;
        renderCurrentQuestion();
    }, 1500);
}

function renderQuizResults() {
    const percentage = Math.round((userScore / currentQuiz.length) * 100);
    modalChallengesList.innerHTML = `
        <div class="quiz-results">
            <div class="result-score">${percentage}%</div>
            <p class="result-text">You got ${userScore} out of ${currentQuiz.length} correct!</p>
            <p class="result-message">${getScoreMessage(percentage)}</p>
        </div>
    `;
    startChatBtn.textContent = "Start Mentoring Session";
    startChatBtn.classList.remove('hidden');
}

function getScoreMessage(p) {
    if (p === 100) return "Masterful! You have a deep understanding of this document.";
    if (p >= 60) return "Well done! You have a solid grasp, but there's more to learn.";
    return "Great start! Let's dive into the chat to clarify some of these concepts.";
}

// Modal Event Listeners
closeModalBtn.addEventListener('click', () => challengeModal.classList.add('hidden'));
startChatBtn.addEventListener('click', () => challengeModal.classList.add('hidden'));

// Summary Event Listeners
viewSummaryBtn.addEventListener('click', async () => {
    summaryModal.classList.remove('hidden');
    summaryContent.innerHTML = `
        <div class="processing">
            <div class="dot-flashing"></div>
            <span>Generating Summary...</span>
        </div>
    `;
    summaryScrollBtn.classList.add('hidden');
    
    try {
        const summary = await ragEngine.generateSummary();
        summaryContent.innerHTML = formatContent(summary);
        
        // Check for overflow after content is set
        setTimeout(() => {
            if (summaryContent.scrollHeight > summaryContent.clientHeight) {
                summaryScrollBtn.classList.remove('hidden');
            }
        }, 100);
    } catch (error) {
        let errorMsg = error.message;
        if (errorMsg.includes('429') || errorMsg.toLowerCase().includes('quota')) {
            errorMsg = `<strong>Quota Exceeded (429):</strong> You've reached the free limit for this model. <br><br> 💡 <em>Try waiting 10 seconds or switching to "gemini-1.5-flash" in the sidebar.</em>`;
        }
        summaryContent.innerHTML = `<div class="error-container">${errorMsg}</div>`;
    }
});

takeQuizBtn.addEventListener('click', async () => {
    takeQuizBtn.disabled = true;
    takeQuizBtn.textContent = '⌛ Preparing...';
    
    try {
        const challenges = await ragEngine.generateTrickyQuestions();
        if (challenges && challenges.length > 0) {
            showChallengeModal(challenges);
        } else {
            addMessage('system', 'Unable to generate questions right now. Try again in a moment.');
        }
    } catch (error) {
        addMessage('system', 'Error generating quiz: ' + error.message);
    } finally {
        takeQuizBtn.disabled = false;
        takeQuizBtn.textContent = '🎯 Take Quiz';
    }
});

summaryScrollBtn.addEventListener('click', () => {
    summaryContent.scrollTo({
        top: summaryContent.scrollHeight,
        behavior: 'smooth'
    });
    summaryScrollBtn.classList.add('hidden');
});

// Hide scroll button when user scrolls near bottom
summaryContent.addEventListener('scroll', () => {
    const isAtBottom = summaryContent.scrollHeight - summaryContent.scrollTop <= summaryContent.clientHeight + 20;
    if (isAtBottom) {
        summaryScrollBtn.classList.add('hidden');
    }
});


closeSummaryModal.addEventListener('click', () => {
    summaryModal.classList.add('hidden');
});

closeSummaryBtn.addEventListener('click', () => {
    summaryModal.classList.add('hidden');
});

function formatContent(text) {
    if (!text) return "No content available.";
    
    // Convert [IMAGE: keyword] into actual images
    let formatted = text.replace(/\[IMAGE:\s*(.*?)\]/gi, (match, keyword) => {
        const cleanKeyword = keyword.trim().replace(/\s+/g, ',');
        return `<div class="dynamic-image-container">
            <img src="https://loremflickr.com/600/400/${cleanKeyword}" alt="${keyword}" class="dynamic-image" onerror="this.parentElement.style.display='none'">
            <span class="image-caption">🔍 Visual: ${keyword}</span>
        </div>`;
    });

    // Basic markdown-like formatting for bold, bullets, and newlines
    formatted = formatted
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/^\* (.*)/gm, '<li>$1</li>')
        .replace(/^- (.*)/gm, '<li>$1</li>')
        .replace(/\n/g, '<br>');
    
    if (formatted.includes('<li>')) {
        formatted = `<ul>${formatted}</ul>`.replace(/<br><ul>/g, '<ul>');
    }
    
    return formatted;
}

function updateInsights() {
    if (!ragEngine) return;
    const insights = ragEngine.getInsights();
    
    topicsList.innerHTML = insights.map(topic => `
        <div class="topic-item">
            <div class="topic-header">
                <span>${topic.name}</span>
                ${topic.isLagging ? '<span class="lagging">Lagging</span>' : '<span class="success">✓ Mastered</span>'}
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${topic.mastery}%"></div>
            </div>
        </div>
    `).join('');
}

function updateUIState() {
    const hasEngine = !!ragEngine;
    const isLocal = ragEngine?.provider === 'ollama';
    const hasKey = isLocal || (ragEngine?.apiKey && ragEngine.apiKey.length > 5);
    const hasDoc = pdfEngine.getChunks().length > 0;
    const hasInput = userInput.value.trim().length > 0;
    
    sendBtn.disabled = !hasKey || !hasDoc || !hasInput;
    
    // Ensure dropzone is enabled
    dropZone.style.opacity = "1";
    dropZone.style.pointerEvents = "auto";
}
