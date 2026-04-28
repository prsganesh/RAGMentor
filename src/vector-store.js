export class VectorStore {
    constructor(dbName = "PDFMentorDB") {
        this.dbName = dbName;
        this.db = null;
        this.storeName = "vectors";
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: "id", autoIncrement: true });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log("Vector DB initialized successfully");
                resolve();
            };

            request.onerror = (event) => {
                console.error("Vector DB error:", event.target.error);
                reject(event.target.error);
            };
        });
    }

    async addVectors(chunks, embeddings, metadata = {}) {
        if (!this.db) await this.init();

        const transaction = this.db.transaction([this.storeName], "readwrite");
        const store = transaction.objectStore(this.storeName);

        for (let i = 0; i < chunks.length; i++) {
            store.add({
                text: chunks[i],
                embedding: embeddings[i],
                metadata: {
                    ...metadata,
                    timestamp: Date.now(),
                    chunkIndex: i
                }
            });
        }

        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async similaritySearch(queryEmbedding, k = 3) {
        if (!this.db) await this.init();

        const transaction = this.db.transaction([this.storeName], "readonly");
        const store = transaction.objectStore(this.storeName);
        const request = store.getAll();

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                const allData = request.result;
                const results = allData.map(item => ({
                    ...item,
                    similarity: this.cosineSimilarity(queryEmbedding, item.embedding)
                }))
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, k);

                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
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

    async clear() {
        if (!this.db) await this.init();
        const transaction = this.db.transaction([this.storeName], "readwrite");
        transaction.objectStore(this.storeName).clear();
        return new Promise((resolve) => {
            transaction.oncomplete = () => resolve();
        });
    }
}
