#!/usr/bin/env node

import EasyAI from "../../EasyAI.js"
import Chat from "../ChatModule/Chat.js"
import PM2 from "../useful/PM2.js"
import ServerSaves from "../MenuCLI/ServerSaves.js"
import ConfigManager from "../ConfigManager.js"
import ColorText from '../useful/ColorText.js'
import TerminalHUD from "../TerminalHUD.js"
import ModelsList from '../MenuCLI/ModelsList.js'
import FreePort from "../useful/FreePort.js"
import ChatHUD from "../ChatHUD.js";
import { forceCleanAllReadlineInterfaces } from "../util/cleanup.js"

let ai
let process_name
let port

async function silentPM2Delete(processName) {
    if (!processName) return
    
    const originalWrite = process.stdout.write
    const originalErrWrite = process.stderr.write
    
    process.stdout.write = () => true
    process.stderr.write = () => true
    
    try {
        await PM2.Delete(processName)
    } catch (error) {
        // Silently ignore deletion errors
    } finally {
        process.stdout.write = originalWrite
        process.stderr.write = originalErrWrite
        console.clear()
    }
}

process.on('exit', async () => {
    if (process_name) {
        await silentPM2Delete(process_name)
    }
})

const StartChat = (ai, process_name) => {
    const chat = new Chat()
    console.clear()
    
    let messageHistory = []
    
    const messageProcessor = async (triggerMessage, displayToken, allMessages = [triggerMessage]) => {
        for (const msg of allMessages) {
            const lastUserMsg = messageHistory.filter(m => m.role === 'user').pop()
            if (!lastUserMsg || lastUserMsg.content !== msg) {
                chat.NewMessage('user', msg)
                messageHistory.push({ role: 'user', content: msg })
            }
        }
        
        let fullResponse = ''
        
        try {
            const result = await ai.Chat(chat.Historical, {
                tokenCallback: async (token) => {
                    let content = ''
                    if (typeof token === 'string') {
                        content = token
                    } else if (token?.stream?.content) {
                        content = token.stream.content
                    } else if (token?.content) {
                        content = token.content
                    }
                    
                    if (content) {
                        fullResponse += content
                        await displayToken(content)
                    }
                },
                stream: true
            })
            
            if (fullResponse && fullResponse.trim()) {
                chat.NewMessage('assistant', fullResponse.trim())
                messageHistory.push({ role: 'assistant', content: fullResponse.trim() })
            } else if (result?.full_text && typeof result.full_text === 'string') {
                const cleanText = result.full_text.trim()
                chat.NewMessage('assistant', cleanText)
                messageHistory.push({ role: 'assistant', content: cleanText })
            }
            
        } catch (error) {
            const errorMessage = '\n[Error occurred. Please try again.]'
            fullResponse = errorMessage
            await displayToken(errorMessage)
            chat.NewMessage('assistant', errorMessage)
            messageHistory.push({ role: 'assistant', content: errorMessage })
            console.error('\n❌ Chat error:', error.message)
        }
        
        return fullResponse
    }
    
    const chatHUD = new ChatHUD({
        messageProcessor: messageProcessor,
        colors: {
            border: '\x1b[38;5;39m',
            title: '\x1b[1;38;5;220m',
            user: '\x1b[32m',
            userText: '\x1b[37m',
            bot: '\x1b[36m',
            botText: '\x1b[35m',
            system: '\x1b[33m',
            systemText: '\x1b[37m',
            timestamp: '\x1b[90m',
            prompt: '\x1b[38;5;220m',
            cursor: '\x1b[48;5;220;30m',
            botIndicator: '\x1b[3;90m'
        },
        messages: {
            welcome: '🚀 Welcome to Flash Chat!',
            initialBot: 'Hello! How can I help you today?',
            goodbye: '\n✨ Chat ended. Goodbye! ✨'
        },
        onExit: async (instance) => {
            instance.cleanup()
            if (process_name) {
                await silentPM2Delete(process_name)
            }
            console.clear()
            process.exit(0)
            console.clear()
        },
        title: 'EasyAI'
    })
    
    const sigintHandler = () => {
        chatHUD.cleanup();
        process.removeListener('SIGINT', sigintHandler);
    };
    process.once('SIGINT', sigintHandler);
    
    chatHUD.start();
}

// Helper to close TerminalHUD and cleanup before starting chat
async function closeMenuAndStartChat(cliInstance, startChatCallback) {
    // Close the menu interface first
    cliInstance.close()
    console.clear()
    
    // Force cleanup of all readline interfaces
    await forceCleanAllReadlineInterfaces()
    
    // Small delay to ensure cleanup is complete
    await new Promise(resolve => setTimeout(resolve, 200))
    
    // Now start the chat
    startChatCallback()
}

// Models menu
async function createModelsMenu(cliInstance) {
    let final_array = []
    let saves_array = await ModelsList()
    
    saves_array.forEach(e => {
        final_array.push({
            name: `${e.name} | ${e.size} GB`,
            action: async () => {
                await closeMenuAndStartChat(cliInstance, async () => {
                    let model = `./models/${e.name}`
                    port = await FreePort(4000)
                    process_name = await EasyAI.Server.PM2({
                        handle_port: false,
                        port: port,
                        EasyAI_Config: {
                            llama: {
                                llama_model: model
                            }
                        }
                    })
                    ai = new EasyAI({
                        server_url: 'localhost',
                        server_port: port
                    })
                    StartChat(ai, process_name)
                })
            }
        })
    })
    
    final_array.push({
        name: 'Exit',
        action: () => {
            console.clear()
            process.exit()
        }
    })
    
    return final_array
}

// OpenAI setup
async function setupOpenAI() {
    let cli = new TerminalHUD()
    let final_object = {}
    
    final_object.token = await cli.ask('OpenAI Token: ')
    final_object.model = await cli.ask('Select the model', {
        options: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo-preview', 'gpt-3.5-turbo-instruct']
    })
    
    let save = await cli.ask('Save the OpenAI config? ', {
        options: ['yes', 'no']
    })
    
    if (save == 'yes') {
        ConfigManager.setKey('openai', final_object)
    }
    
    await closeMenuAndStartChat(cli, () => {
        ai = new EasyAI({
            openai_token: final_object.token,
            openai_model: final_object.model
        })
        StartChat(ai)
    })
}

// DeepInfra setup
async function setupDeepInfra() {
    let cli = new TerminalHUD()
    let final_object = {}
    
    final_object.token = await cli.ask('DeepInfra Token: ')
    final_object.model = await cli.ask('Select the model', {
        options: [
            'deepseek-ai/DeepSeek-V3.2',
            'meta-llama/Meta-Llama-3.1-8B-Instruct',
            'Qwen/Qwen3-235B-A22B-Instruct-2507',
            'zai-org/GLM-4.7-Flash'
        ]
    })
    
    let save = await cli.ask('Save the DeepInfra config? ', {
        options: ['yes', 'no']
    })
    
    if (save == 'yes') {
        ConfigManager.setKey('deepinfra', final_object)
    }
    
    await closeMenuAndStartChat(cli, () => {
        ai = new EasyAI({
            deepinfra_token: final_object.token,
            deepinfra_model: final_object.model
        })
        StartChat(ai)
    })
}

// Handle saved server
async function handleSavedServer(saveName) {
    try {
        const save = await ServerSaves.Load(saveName)
        
        process_name = await EasyAI.Server.PM2({
            handle_port: false,
            token: save.Token,
            port: save.Port,
            EasyAI_Config: save.EasyAI_Config
        })
        
        console.log('✔️ PM2 Server iniciado com sucesso!')
        
        ai = new EasyAI({
            server_url: 'localhost',
            server_port: save.Port
        })
        
        StartChat(ai, process_name)
    } catch (e) {
        // If save not found, start fresh
        console.log(`Save ${ColorText.red(saveName)} não foi encontrado`)
        await startDefaultServer()
    }
}

// Default server startup
async function startDefaultServer() {
    port = await FreePort(4000)
    process_name = await EasyAI.Server.PM2({
        handle_port: false,
        port: port
    })
    
    ai = new EasyAI({
        server_url: 'localhost',
        server_port: port
    })
    
    StartChat(ai, process_name)
}

// Main execution
async function main() {
    const args = process.argv.slice(2)
    
    // Handle models argument
    if (args.length > 0 && args[0] === "models") {
        let cli = new TerminalHUD()
        const menuOptions = await createModelsMenu(cli)
        
        // Create menu generator function that displayMenu expects
        const menuGenerator = async (props) => {
            return {
                title: 'Select Model',
                options: menuOptions
            }
        }
        
        await cli.displayMenu(menuGenerator)
        // Note: cli is closed inside the action via closeMenuAndStartChat
        return
    }
    
    // Get model/provider from args or config
    const toload = args.length > 0 ? args[0] : ConfigManager.getKey('defaultchatsave')
    
    if (!toload) {
        // No arguments and no default config - start default server
        await startDefaultServer()
        return
    }
    
    const toloadLower = toload.toLowerCase()
    
    // Handle OpenAI
    if (toloadLower === 'openai') {
        if (ConfigManager.getKey('openai')) {
            const openai_info = ConfigManager.getKey('openai')
            ai = new EasyAI({
                openai_token: openai_info.token,
                openai_model: openai_info.model
            })
            StartChat(ai)
        } else {
            await setupOpenAI()
        }
        return
    }
    
    // Handle DeepInfra
    if (toloadLower === 'deepinfra') {
        if (ConfigManager.getKey('deepinfra')) {
            const deepinfra_info = ConfigManager.getKey('deepinfra')
            ai = new EasyAI({
                deepinfra_token: deepinfra_info.token,
                deepinfra_model: deepinfra_info.model
            })
            StartChat(ai)
        } else {
            await setupDeepInfra()
        }
        return
    }
    
    // Handle saved server
    await handleSavedServer(toload)
}

// Run the application
main().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
})