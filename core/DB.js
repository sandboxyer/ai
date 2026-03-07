// ========== db.js - Fixed Constructor Chain ==========
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import crypto from 'crypto';
import { EventEmitter } from 'events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Debug flag
const DEBUG = false;

function debugLog(...args) {
    if (DEBUG) {
        console.log('[DEBUG]', ...args);
    }
}

// ========== MACHINE ID GENERATION ==========
function getMachineId() {
    try {
        const interfaces = os.networkInterfaces();
        for (const [name, addrs] of Object.entries(interfaces)) {
            for (const addr of addrs) {
                if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
                    return addr.mac.replace(/:/g, '');
                }
            }
        }
        return os.hostname().replace(/[^a-zA-Z0-9]/g, '');
    } catch (error) {
        return `machine-${crypto.createHash('md5').update(__dirname).digest('hex').substr(0, 8)}`;
    }
}

function generateUniqueId() {
    // Always generate a truly unique ID with timestamp + random component
    return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

// ========== Lock Manager ==========
class LockManager {
    constructor() {
        this.locks = new Map();
        this.timeout = 5000;
    }

    async acquire(key, timeout = 5000) {
        const startTime = Date.now();
        
        while (this.locks.has(key)) {
            if (Date.now() - startTime > timeout) {
                throw new Error(`Lock acquisition timeout for key: ${key}`);
            }
            await new Promise(resolve => setImmediate(resolve));
        }
        
        this.locks.set(key, {
            acquired: Date.now(),
            timeout: this.timeout
        });
        
        return {
            release: () => this.release(key)
        };
    }

    release(key) {
        this.locks.delete(key);
    }

    isLocked(key) {
        return this.locks.has(key);
    }
}

// ========== Memory Manager ==========
class MemoryManager extends EventEmitter {
    constructor(options = {}) {
        super();
        this.maxInstances = options.maxInstances || 1000;
        this.maxMemoryPercent = options.maxMemoryPercent || 70;
        this.instanceAccess = new Map();
        this.instanceData = new Map();
        this.unloadTimeout = options.unloadTimeout || 30 * 60 * 1000;
        this.checkInterval = options.checkInterval || 60 * 1000;
        this._interval = null;
        this._instanceCount = 0;
    }

    startMonitoring() {
        if (this._instanceCount > 0 && !this._interval) {
            this._interval = setInterval(() => {
                this.checkMemoryAndUnload().catch(console.error);
            }, this.checkInterval);
            this._interval.unref();
        }
    }

    stopMonitoring() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
    }

    incrementInstanceCount() {
        this._instanceCount++;
        this.startMonitoring();
    }

    decrementInstanceCount() {
        this._instanceCount = Math.max(0, this._instanceCount - 1);
        if (this._instanceCount === 0) {
            this.stopMonitoring();
        }
    }

    getMemoryUsagePercent() {
        const used = process.memoryUsage().heapUsed;
        const total = os.totalmem();
        return (used / total) * 100;
    }

    async checkMemoryAndUnload() {
        if (this._instanceCount === 0) {
            this.stopMonitoring();
            return;
        }

        const memoryPercent = this.getMemoryUsagePercent();
        
        if (memoryPercent > this.maxMemoryPercent || this.instanceAccess.size > this.maxInstances) {
            await this.unloadLeastUsed();
        }
    }

    async unloadLeastUsed() {
        const now = Date.now();
        const instances = Array.from(this.instanceAccess.entries());
        instances.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
        
        let unloaded = 0;
        const targetUnload = Math.floor(this.instanceAccess.size * 0.2);
        
        for (const [key, data] of instances) {
            if (unloaded >= targetUnload) break;
            
            if (now - data.lastAccess > this.unloadTimeout && !data.dirty) {
                this.instanceData.set(key, data.serialized);
                this.instanceAccess.delete(key);
                this.emit('instanceUnloaded', key);
                unloaded++;
            }
        }
    }

    registerAccess(instance) {
        const key = instance.__storageKey;
        this.instanceAccess.set(key, {
            lastAccess: Date.now(),
            dirty: instance.__dirty || false,
            serialized: instance.__getSerializedState ? instance.__getSerializedState() : {}
        });
    }

    markDirty(instance) {
        const key = instance.__storageKey;
        const data = this.instanceAccess.get(key);
        if (data) {
            data.dirty = true;
            data.lastAccess = Date.now();
        }
    }

    markClean(instance) {
        const key = instance.__storageKey;
        const data = this.instanceAccess.get(key);
        if (data) {
            data.dirty = false;
        }
    }

    updateSerialized(instance, serialized) {
        const key = instance.__storageKey;
        const data = this.instanceAccess.get(key);
        if (data) {
            data.serialized = serialized;
        }
    }

    shouldLoad(key) {
        return !this.instanceAccess.has(key) && this.instanceData.has(key);
    }

    getUnloadedData(key) {
        return this.instanceData.get(key);
    }

    removeUnloadedData(key) {
        this.instanceData.delete(key);
    }
}

// ========== Transaction Logger ==========
class TransactionLogger {
    constructor(storage) {
        this.storage = storage;
        this.logFile = path.join(storage.folder, '_transactions.log');
        this.pendingTransactions = new Map();
    }

    async begin(instanceKey) {
        const transactionId = crypto.randomBytes(16).toString('hex');
        this.pendingTransactions.set(transactionId, {
            instanceKey,
            changes: [],
            timestamp: Date.now()
        });
        
        await this._log('BEGIN', transactionId, instanceKey);
        return transactionId;
    }

    async logChange(transactionId, key, oldValue, newValue) {
        const transaction = this.pendingTransactions.get(transactionId);
        if (transaction) {
            transaction.changes.push({ key, oldValue, newValue });
            await this._log('CHANGE', transactionId, { key, oldValue, newValue });
        }
    }

    async commit(transactionId) {
        const transaction = this.pendingTransactions.get(transactionId);
        if (transaction) {
            await this._log('COMMIT', transactionId);
            this.pendingTransactions.delete(transactionId);
        }
    }

    async rollback(transactionId) {
        const transaction = this.pendingTransactions.get(transactionId);
        if (transaction) {
            await this._log('ROLLBACK', transactionId);
            this.pendingTransactions.delete(transactionId);
        }
    }

    async _log(type, transactionId, data = null) {
        const logEntry = {
            type,
            transactionId,
            timestamp: Date.now(),
            data
        };
        
        try {
            await fs.appendFile(this.logFile, JSON.stringify(logEntry) + '\n');
        } catch (error) {
            console.error('Transaction log error:', error);
        }
    }
}

// ========== Default Storage ==========
let defaultStorage = null;

export function setDefaultStorage(storage) {
    defaultStorage = storage;
}

export function getDefaultStorage() {
    if (!defaultStorage) {
        defaultStorage = new JSONStorage();
    }
    return defaultStorage;
}

// ========== Storage Connection Interface ==========
export class StorageConnection {
    constructor(options = {}) {
        this.name = options.name || 'app';
        this.autoSave = options.autoSave ?? true;
    }

    async save(key, data) { throw new Error('save() must be implemented'); }
    async load(key) { throw new Error('load() must be implemented'); }
    async delete(key) { throw new Error('delete() must be implemented'); }
    async list() { throw new Error('list() must be implemented'); }
}

// ========== JSON Storage ==========
export class JSONStorage extends StorageConnection {
    constructor(options = {}) {
        super(options);
        this.folder = options.folder || path.join(process.cwd(), 'data');
        this.extension = options.extension || '.json';
        this.writeQueue = new Map();
        this.isWriting = false;
        this.pendingWrites = 0;
        
        fsSync.mkdirSync(this.folder, { recursive: true });
        
        // Mark as non-proxyable
        this.__isStorage = true;
        this.__dontProxy = true;
    }

    _getFilePath(key) {
        // Sanitize the key for filesystem
        const sanitizedKey = key.replace(/[^a-zA-Z0-9._:-]/g, '_');
        return path.join(this.folder, `${sanitizedKey}${this.extension}`);
    }

    _serialize(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        
        if (obj instanceof Map) {
            return { __type: 'Map', data: Array.from(obj.entries()) };
        }
        if (obj instanceof Set) {
            return { __type: 'Set', data: Array.from(obj) };
        }
        if (obj instanceof Date) {
            return { __type: 'Date', data: obj.toISOString() };
        }
        if (obj instanceof RegExp) {
            return { __type: 'RegExp', data: obj.toString() };
        }
        if (obj instanceof Error) {
            return { __type: 'Error', data: { message: obj.message, stack: obj.stack } };
        }
        if (Array.isArray(obj)) {
            return obj.map(v => this._serialize(v));
        }
        
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = this._serialize(value);
        }
        return result;
    }

    _deserialize(obj) {
        if (obj && typeof obj === 'object') {
            if (obj.__type === 'Map') {
                return new Map(obj.data);
            }
            if (obj.__type === 'Set') {
                return new Set(obj.data);
            }
            if (obj.__type === 'Date') {
                return new Date(obj.data);
            }
            if (obj.__type === 'RegExp') {
                const match = obj.data.match(/\/(.*)\/([gimy]*)$/);
                return match ? new RegExp(match[1], match[2]) : new RegExp(obj.data);
            }
            if (obj.__type === 'Error') {
                const error = new Error(obj.data.message);
                error.stack = obj.data.stack;
                return error;
            }
            if (Array.isArray(obj)) {
                return obj.map(v => this._deserialize(v));
            }
            
            const result = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this._deserialize(value);
            }
            return result;
        }
        return obj;
    }

    async save(key, data) {
        debugLog(`Storage.save called for key: ${key}`);
        this.pendingWrites++;
        this.writeQueue.set(key, data);
        
        if (!this.isWriting) {
            this.isWriting = true;
            setImmediate(() => this._processWriteQueue());
        }
    }

    async _processWriteQueue() {
        const writes = Array.from(this.writeQueue.entries());
        this.writeQueue.clear();
        debugLog(`Processing ${writes.length} writes in queue`);
        
        const batchSize = 5;
        for (let i = 0; i < writes.length; i += batchSize) {
            const batch = writes.slice(i, i + batchSize);
            
            const writePromises = batch.map(async ([key, data]) => {
                const filePath = this._getFilePath(key);
                debugLog(`Writing to file: ${filePath}`);
                const serialized = this._serialize(data);
                
                const tempPath = `${filePath}.tmp`;
                try {
                    await fs.writeFile(tempPath, JSON.stringify(serialized, null, 2));
                    await fs.rename(tempPath, filePath);
                    debugLog(`Successfully saved ${key}`);
                } catch (error) {
                    console.error(`Failed to save ${key}:`, error);
                    this.writeQueue.set(key, data);
                }
            });
            
            await Promise.all(writePromises);
            
            if (i + batchSize < writes.length) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }
        
        this.pendingWrites = Math.max(0, this.pendingWrites - writes.length);
        this.isWriting = false;
        
        if (this.writeQueue.size > 0) {
            this.isWriting = true;
            setImmediate(() => this._processWriteQueue());
        }
    }

    async load(key) {
        try {
            const filePath = this._getFilePath(key);
            debugLog(`Loading from file: ${filePath}`);
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);
            debugLog(`Loaded data for ${key}:`, data);
            return this._deserialize(data);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error(`Error loading ${key}:`, err);
            }
            return null;
        }
    }

    async delete(key) {
        try {
            const filePath = this._getFilePath(key);
            await fs.unlink(filePath);
            debugLog(`Deleted file: ${filePath}`);
        } catch (err) {}
    }

    async list() {
        try {
            const files = await fs.readdir(this.folder);
            return files
                .filter(f => f.endsWith(this.extension) && !f.startsWith('_') && !f.endsWith('.tmp'))
                .map(f => f.replace(this.extension, ''));
        } catch (err) {
            return [];
        }
    }

    async flush() {
        debugLog('Flushing storage...');
        while (this.pendingWrites > 0 || this.isWriting) {
            debugLog(`Waiting for writes: pendingWrites=${this.pendingWrites}, isWriting=${this.isWriting}`);
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        debugLog('Flush complete');
    }
}

// ========== Enhanced Cache ==========
const instanceCache = new Map();
const lockManager = new LockManager();
const memoryManager = new MemoryManager();
const transactionLogger = new TransactionLogger(getDefaultStorage());
const SAVE_DEBOUNCE_TIME = 100; // 100ms

// ========== Helper to check if object should be proxied ==========
function shouldProxy(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (obj.__dontProxy) return false;
    if (obj instanceof DB) return false;
    if (obj instanceof Map) return false;
    if (obj instanceof Set) return false;
    if (obj instanceof Date) return false;
    if (obj instanceof RegExp) return false;
    if (obj instanceof Error) return false;
    if (obj.__isProxy) return false;
    return true;
}

// ========== Auto-Save Proxy Creator ==========
function createAutoSaveProxy(instance) {
    let saveTimeout = null;
    let savePromise = null;
    
    // Schedule a save with debouncing
    const scheduleSave = (source) => {
        debugLog(`Schedule save triggered by: ${source}`);
        if (saveTimeout) {
            debugLog('Clearing existing save timeout');
            clearTimeout(saveTimeout);
        }
        
        saveTimeout = setTimeout(async () => {
            debugLog('Save timeout executed');
            try {
                // Ensure we don't have multiple saves running simultaneously
                if (savePromise) {
                    debugLog('Waiting for existing save to complete');
                    await savePromise;
                }
                debugLog('Calling __save()');
                savePromise = instance.__save();
                await savePromise;
                savePromise = null;
                debugLog('Save completed successfully');
            } catch (error) {
                console.error('Auto-save error:', error);
            } finally {
                saveTimeout = null;
            }
        }, SAVE_DEBOUNCE_TIME);
    };
    
    // Immediate save function
    const saveImmediately = async (source) => {
        debugLog(`Immediate save triggered by: ${source}`);
        try {
            if (savePromise) {
                debugLog('Waiting for existing save to complete');
                await savePromise;
            }
            debugLog('Calling __save() immediately');
            savePromise = instance.__save();
            await savePromise;
            savePromise = null;
            debugLog('Immediate save completed');
        } catch (error) {
            console.error('Immediate save error:', error);
        }
    };
    
    // Recursive proxy creator for nested objects
    const createNestedProxy = (target, path = []) => {
        return new Proxy(target, {
            set(obj, prop, value) {
                debugLog(`Nested proxy set: ${path.join('.')}.${prop} =`, value);
                
                // Skip internal properties
                if (prop === '__isProxy' || prop === '__target') {
                    obj[prop] = value;
                    return true;
                }
                
                // Handle the set
                obj[prop] = value;
                
                // Mark as dirty and schedule save
                instance.__dirty = true;
                memoryManager.markDirty(instance);
                scheduleSave(`nested set ${path.join('.')}.${prop}`);
                
                return true;
            },
            
            get(obj, prop) {
                // Special properties
                if (prop === '__isProxy') return true;
                if (prop === '__target') return obj;
                
                const value = obj[prop];
                
                // Create proxy for nested objects/arrays only if they should be proxied
                if (shouldProxy(value)) {
                    debugLog(`Creating nested proxy for ${path.join('.')}.${prop}`);
                    const nestedPath = [...path, prop];
                    obj[prop] = createNestedProxy(value, nestedPath);
                    return obj[prop];
                }
                
                return value;
            },
            
            deleteProperty(obj, prop) {
                debugLog(`Nested proxy delete: ${path.join('.')}.${prop}`);
                delete obj[prop];
                
                instance.__dirty = true;
                memoryManager.markDirty(instance);
                scheduleSave(`nested delete ${path.join('.')}.${prop}`);
                
                return true;
            }
        });
    };
    
    // Wrap methods to properly track changes and save immediately
    const wrapMethod = (obj, methodName, originalMethod) => {
        return async function(...args) {
            debugLog(`Method called: ${methodName} with args:`, args);
            
            // Call the original method with the correct context
            const result = originalMethod.apply(this, args);
            
            // Mark as dirty
            instance.__dirty = true;
            memoryManager.markDirty(instance);
            
            // Save immediately after the method call
            await saveImmediately(`method ${methodName}`);
            
            return result;
        };
    };
    
    // Recursively get all methods from the prototype chain
    const getAllMethods = (obj) => {
        const methods = new Set();
        let proto = obj;
        
        while (proto && proto !== Object.prototype) {
            Object.getOwnPropertyNames(proto).forEach(prop => {
                if (prop !== 'constructor' && 
                    typeof proto[prop] === 'function' && 
                    !prop.startsWith('__')) {
                    methods.add(prop);
                }
            });
            proto = Object.getPrototypeOf(proto);
        }
        
        return methods;
    };
    
    // Get all methods from the prototype chain
    const methods = getAllMethods(instance);
    debugLog('Found methods:', Array.from(methods));
    
    // Wrap all methods in the instance
    methods.forEach(methodName => {
        if (typeof instance[methodName] === 'function' && !instance[methodName].__wrapped) {
            debugLog(`Wrapping method: ${methodName}`);
            const original = instance[methodName];
            instance[methodName] = wrapMethod(instance, methodName, original);
            instance[methodName].__wrapped = true;
        }
    });
    
    // Create main instance proxy
    return new Proxy(instance, {
        set(target, prop, value) {
            debugLog(`Main proxy set: ${prop} =`, value);
            
            // Skip internal properties
            if (prop.startsWith('__') || prop === 'constructor') {
                target[prop] = value;
                return true;
            }
            
            // Handle the set
            target[prop] = value;
            
            // Mark as dirty and schedule save
            target.__dirty = true;
            memoryManager.markDirty(target);
            scheduleSave(`direct set ${prop}`);
            
            return true;
        },
        
        get(target, prop) {
            // Internal properties
            if (prop === '__isProxy') return true;
            if (prop === '__target') return target;
            
            // Get the value
            const value = target[prop];
            
            // Handle methods
            if (typeof value === 'function' && prop !== 'constructor') {
                return value;
            }
            
            // Handle nested objects only if they should be proxied
            if (shouldProxy(value)) {
                debugLog(`Creating main proxy nested for: ${prop}`);
                target[prop] = createNestedProxy(value, [prop]);
                return target[prop];
            }
            
            return value;
        },
        
        deleteProperty(target, prop) {
            debugLog(`Main proxy delete: ${prop}`);
            
            if (prop.startsWith('__')) {
                delete target[prop];
                return true;
            }
            
            delete target[prop];
            
            target.__dirty = true;
            memoryManager.markDirty(target);
            scheduleSave(`delete ${prop}`);
            
            return true;
        }
    });
}

// ========== Helper to get inheritance chain ==========
function getInheritanceChain(obj) {
    const chain = [];
    let current = obj;
    
    while (current && current.constructor && current.constructor.name) {
        if (current.constructor.name !== 'Object' && current.constructor.name !== 'DB') {
            chain.unshift(current.constructor.name);
        }
        current = Object.getPrototypeOf(current);
        if (current && current.constructor === DB) break;
    }
    
    return chain;
}

// ========== Helper to reconstruct instance with constructor data ==========
function reconstructInstance(ClassType, id, storage, data) {
    // Create a new instance WITHOUT calling the constructor with parameters
    // This is the key fix - we need to create the instance and THEN apply the data
    const instance = new ClassType({ id, storage });
    
    // Apply the loaded data to the instance
    if (data) {
        for (const [key, value] of Object.entries(data)) {
            if (!key.startsWith('__') && typeof value !== 'function') {
                instance[key] = value;
            }
        }
    }
    
    return instance;
}

// ========== The Enhanced DB Class ==========
class DB {
    constructor(options = {}) {
        debugLog('DB constructor called with options:', options);
        
        // Generate ID if not provided
        const finalUniqueKey = options.id || generateUniqueId();
        
        // Use provided storage or get default
        this.__storage = options.storage || getDefaultStorage();
        this.__autoSave = this.__storage.autoSave;
        this.__uniqueKey = finalUniqueKey;
        
        // Build the full key with inheritance chain
        this.__buildKey();
        
        // Track if we've loaded data to prevent overwriting
        this.__loaded = false;
        
        // Cache key for this instance
        const cacheKey = `${this.constructor.name}:${this.__storageKey}`;
        
        // Only return cached instance if we're explicitly trying to load an existing instance
        if (!DEBUG && options.id && instanceCache.has(cacheKey)) {
            debugLog(`Returning cached instance for ${cacheKey}`);
            return instanceCache.get(cacheKey);
        }
        
        // Check if we should load from memory manager
        if (memoryManager.shouldLoad(this.__storageKey)) {
            debugLog(`Loading unloaded data for ${this.__storageKey}`);
            const unloadedData = memoryManager.getUnloadedData(this.__storageKey);
            if (unloadedData) {
                Object.assign(this, unloadedData);
                memoryManager.removeUnloadedData(this.__storageKey);
                this.__loaded = true;
            }
        }
        
        // Load existing data - but only if this is NOT a new instance being created
        // This prevents overwriting constructor-set values
        if (options.id) {
            // This is an existing instance being loaded, so load the data
            this.__loadSync();
        } else {
            // This is a new instance, don't load anything, just mark as dirty so it saves
            this.__dirty = true;
        }
        
        // Initialize state if not already set
        this.__dirty = this.__dirty || false;
        
        // Store in cache
        instanceCache.set(cacheKey, this);
        
        memoryManager.registerAccess(this);
        memoryManager.incrementInstanceCount();
        
        debugLog(`Instance created with key: ${this.__storageKey}`);
        
        // Return auto-save proxy
        return createAutoSaveProxy(this);
    }

    __buildKey() {
        const chain = getInheritanceChain(this);
        this.__storageKey = `${chain.join('.')}:${this.__uniqueKey}`;
        debugLog(`Built storage key: ${this.__storageKey}`);
    }

    __loadSync() {
        try {
            const filePath = this.__storage._getFilePath(this.__storageKey);
            debugLog(`Attempting to load from: ${filePath}`);
            if (fsSync.existsSync(filePath)) {
                const content = fsSync.readFileSync(filePath, 'utf-8');
                debugLog('File content:', content);
                const data = JSON.parse(content);
                const deserialized = this.__storage._deserialize(data);
                debugLog('Deserialized data:', deserialized);
                
                // Apply loaded data - but don't overwrite existing properties
                // This ensures constructor values are preserved
                for (const [key, value] of Object.entries(deserialized)) {
                    if (!key.startsWith('__') && typeof value !== 'function') {
                        // Only set if not already set (preserve constructor values)
                        if (this[key] === undefined) {
                            this[key] = value;
                        }
                    }
                }
                this.__loaded = true;
                debugLog('Data loaded successfully');
            } else {
                debugLog('File does not exist, starting fresh');
            }
        } catch (err) {
            debugLog('Error loading data:', err.message);
        }
    }

    async __loadWithLock() {
        if (lockManager.isLocked(this.__storageKey)) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        const lock = await lockManager.acquire(this.__storageKey);
        try {
            const data = await this.__storage.load(this.__storageKey);
            if (data) {
                for (const [key, value] of Object.entries(data)) {
                    if (!key.startsWith('__') && typeof value !== 'function') {
                        this[key] = value;
                    }
                }
            }
        } finally {
            lock.release();
        }
    }

    __getSerializedState() {
        const state = {};
        
        // Get all enumerable properties from the object
        for (const key in this) {
            // Skip internal properties and methods
            if (key.startsWith('__') || 
                key === 'constructor' || 
                typeof this[key] === 'function') {
                continue;
            }
            
            // Add the property to state
            state[key] = this[key];
        }
        
        return state;
    }

    async __save(transactionId = null) {
        debugLog(`__save called for ${this.__storageKey}, dirty: ${this.__dirty}`);
        
        // Skip if not dirty
        if (!this.__dirty) {
            debugLog('Not dirty, skipping save');
            return this;
        }
        
        const state = this.__getSerializedState();
        debugLog('State to save:', state);
        
        // Update memory manager with serialized state
        memoryManager.updateSerialized(this, state);
        
        const lock = await lockManager.acquire(this.__storageKey);
        try {
            if (transactionId) {
                const oldState = await this.__storage.load(this.__storageKey);
                await transactionLogger.logChange(transactionId, this.__storageKey, oldState, state);
            }
            
            await this.__storage.save(this.__storageKey, state);
            this.__dirty = false;
            memoryManager.markClean(this);
            debugLog('Save completed successfully');
            
        } finally {
            lock.release();
        }
        
        return this;
    }

    async saveWithTransaction() {
        const transactionId = await transactionLogger.begin(this.__storageKey);
        try {
            await this.__save(transactionId);
            await transactionLogger.commit(transactionId);
        } catch (error) {
            await transactionLogger.rollback(transactionId);
            throw error;
        }
        return this;
    }

    // Public API
    get uniqueKey() {
        return this.__uniqueKey;
    }

    get inheritanceChain() {
        return getInheritanceChain(this);
    }

    get storageKey() {
        return this.__storageKey;
    }

    async delete() {
        const lock = await lockManager.acquire(this.__storageKey);
        try {
            await this.__storage.delete(this.__storageKey);
            
            // Remove from cache
            const cacheKey = `${this.constructor.name}:${this.__storageKey}`;
            instanceCache.delete(cacheKey);
            
            memoryManager.removeUnloadedData(this.__storageKey);
            memoryManager.decrementInstanceCount();
        } finally {
            lock.release();
        }
        return this;
    }

    async reload() {
        await this.__loadWithLock();
        this.__dirty = false;
        memoryManager.markClean(this);
        return this;
    }

    // FIXED: Static methods for retrieving instances
    static async getAll(storage = null) {
        const store = storage || getDefaultStorage();
        const keys = await store.list();
        const instances = [];
        const className = this.name;
        
        for (const key of keys) {
            const [classChain] = key.split(':');
            const classes = classChain.split('.');
            const lastClass = classes[classes.length - 1];
            
            // Match exact class name
            if (lastClass === className) {
                const uniqueKey = key.split(':')[1];
                
                // Check cache first
                const cacheKey = `${className}:${key}`;
                if (instanceCache.has(cacheKey)) {
                    instances.push(instanceCache.get(cacheKey));
                } else {
                    // Load the data first
                    const data = await store.load(key);
                    
                    // Create instance with ID but don't let constructor load data again
                    const instance = new this({ id: uniqueKey, storage: store });
                    
                    // Apply the loaded data (this will preserve constructor values)
                    if (data) {
                        for (const [prop, value] of Object.entries(data)) {
                            if (!prop.startsWith('__') && typeof value !== 'function') {
                                instance[prop] = value;
                            }
                        }
                    }
                    
                    instances.push(instance);
                }
            }
        }
        
        return instances;
    }
    
    static async getAllIncludingSubclasses(storage = null) {
        const store = storage || getDefaultStorage();
        const keys = await store.list();
        const instances = [];
        const className = this.name;
        
        for (const key of keys) {
            const [classChain] = key.split(':');
            const classes = classChain.split('.');
            
            if (classes.includes(className)) {
                const uniqueKey = key.split(':')[1];
                
                // Check cache first
                const cacheKey = `${className}:${key}`;
                if (instanceCache.has(cacheKey)) {
                    instances.push(instanceCache.get(cacheKey));
                } else {
                    // Load the data first
                    const data = await store.load(key);
                    
                    // Create instance with ID
                    const instance = new this({ id: uniqueKey, storage: store });
                    
                    // Apply the loaded data
                    if (data) {
                        for (const [prop, value] of Object.entries(data)) {
                            if (!prop.startsWith('__') && typeof value !== 'function') {
                                instance[prop] = value;
                            }
                        }
                    }
                    
                    instances.push(instance);
                }
            }
        }
        
        return instances;
    }
    
    static async findBy(uniqueKey, storage = null) {
        const store = storage || getDefaultStorage();
        const keys = await store.list();
        const className = this.name;
        
        for (const key of keys) {
            const keyParts = key.split(':');
            const keyUniquePart = keyParts[keyParts.length - 1];
            
            if (keyUniquePart === uniqueKey) {
                // Check cache first
                const cacheKey = `${className}:${key}`;
                if (instanceCache.has(cacheKey)) {
                    return instanceCache.get(cacheKey);
                }
                
                // Load the data first
                const data = await store.load(key);
                
                // Create instance with ID
                const instance = new this({ id: uniqueKey, storage: store });
                
                // Apply the loaded data
                if (data) {
                    for (const [prop, value] of Object.entries(data)) {
                        if (!prop.startsWith('__') && typeof value !== 'function') {
                            instance[prop] = value;
                        }
                    }
                }
                
                return instance;
            }
        }
        return null;
    }

    static getMachineId() {
        return getMachineId();
    }

    static generateUniqueId() {
        return generateUniqueId();
    }

    static setMemoryOptions(options) {
        if (options.maxInstances) memoryManager.maxInstances = options.maxInstances;
        if (options.maxMemoryPercent) memoryManager.maxMemoryPercent = options.maxMemoryPercent;
        if (options.unloadTimeout) memoryManager.unloadTimeout = options.unloadTimeout;
    }

    static async unloadInstance(key) {
        if (instanceCache.has(key)) {
            const instance = instanceCache.get(key);
            if (!instance.__dirty) {
                instanceCache.delete(key);
                memoryManager.removeUnloadedData(key);
                memoryManager.decrementInstanceCount();
            }
        }
    }

    static async flushAll() {
        debugLog('Flushing all instances...');
        const saves = [];
        for (const [key, instance] of instanceCache) {
            if (instance.__dirty) {
                debugLog(`Saving dirty instance: ${key}`);
                saves.push(instance.__save());
            }
        }
        await Promise.all(saves);
        await getDefaultStorage().flush();
        debugLog('Flush all complete');
    }
}

export default DB;