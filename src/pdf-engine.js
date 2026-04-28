import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Set worker source for pdfjs
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export class PDFEngine {
    constructor() {
        this.currentDocument = null;
        this.chunks = [];
    }

    async loadPDF(file) {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        let fullText = '';
        const numPages = pdf.numPages;
        
        for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n\n';
        }

        this.chunks = this.chunkText(fullText);
        return {
            numPages,
            numChunks: this.chunks.length,
            name: file.name
        };
    }

    chunkText(text, size = 800, overlap = 150) {
        const words = text.split(/\s+/);
        const chunks = [];
        
        for (let i = 0; i < words.length; i += (size - overlap)) {
            const chunk = words.slice(i, i + size).join(' ');
            if (chunk.trim()) {
                chunks.push(chunk);
            }
            if (i + size >= words.length) break;
        }
        
        return chunks;
    }

    getChunks() {
        return this.chunks;
    }
}
