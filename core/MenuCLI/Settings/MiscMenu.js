import SettingsMenu from "./SettingsMenu.js";
import ColorText from "../../useful/ColorText.js";
import MenuCLI from "../MenuCLI.js";
import ConfigManager from "../../ConfigManager.js";
import ModelSearch from '../../util/ModelSearch.js'
import getFileInstance from "../../util/File.js";
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import getProjectVersion from "../../util/getProjectVersion.js";

// system level
// --------------------------------------------------
const modelsDir = `${process.env.PWD}/models`;

if (!existsSync(modelsDir)) {
  await mkdir(modelsDir, { recursive: true });
}
// --------------------------------------------------

// process level
// --------------------------------------------------
let models_array = []
let load_count = 10

// Helper function to insert model in size order
const insertModelBySize = (array, model) => {
  // Find the correct position based on size (descending order)
  let insertIndex = 0
  for (let i = 0; i < array.length; i++) {
    if (array[i].size <= model.size) {
      insertIndex = i
      break
    }
    insertIndex = i + 1
  }
  array.splice(insertIndex, 0, model)
  return array
}

let options_array = async (config = {expanded : false, refresh : false, loadmore : false, reset_loadcount : false}) => {
  let expanded = config.expanded || -1
  let refresh = config.refresh || false
  let loadmore = config.loadmore || false
  let reset_loadcount = config.reset_loadcount || false

  if(loadmore){
    load_count = load_count+5
  }

  if(reset_loadcount){load_count = 10}

  let final_array = []
  let external_count = 0
  let old_external_array = []

  // Save existing external models before rebuilding
  models_array.forEach(e => {
    if(e.type == 'external'){
      external_count++
      old_external_array.push(e)
    } 
  })

  // Rebuild the loaded models from /models directory
  let new_models_array = []
  
  // Get stored original paths from ConfigManager
  const movedModelsMap = ConfigManager.getKey("models.movedFrom") || {}
  
  ModelSearch.GGUF({startPath : `${process.env.PWD}/models`}).forEach(e => {
    const modelName = e.model
    const originalPath = movedModelsMap[modelName]
    new_models_array.push({
      type : 'loaded', 
      ...e,
      originalPath: originalPath // Add originalPath if it exists in the map
    })
  })

  // Add back the external models
  old_external_array.forEach(e => {new_models_array.push(e)})

  // If refresh is requested or no external models exist, scan for external models
  if(refresh || external_count == 0){
    const externalModels = ModelSearch.GGUF({fastMode : false, excludePaths : [`${process.env.PWD}/models`]})
    externalModels.forEach(e => {
      // Check if this external model is not already in the loaded models
      const existsInLoaded = new_models_array.some(m => m.type === 'loaded' && m.model === e.model)
      if (!existsInLoaded) {
        new_models_array.push({type : 'external', ...e})
      }
    })
  }

  models_array = new_models_array

  // Build the menu options
  models_array.forEach((e,i) => {
    if(i < load_count){
      if(e.type == "external"){
        final_array.push({name : (expanded == i ? ColorText.brightYellow(`${e.model} | ${e.size} GB`) : `${e.model} | ${e.size} GB`),action : () => {
          if(expanded == i){
            MenuCLI.displayMenu(ModelsManagerMenu,{props : {expanded : -1}})
          } else {
            MenuCLI.displayMenu(ModelsManagerMenu,{props : {expanded : i}})
          }
        }})
      } else {
        final_array.push({name : (expanded == i ? ColorText.brightYellow(`${e.model} | ${e.size} GB`) : ColorText.brightGreen(`${e.model} | ${e.size} GB`)),action : () => {
          if(expanded == i){
            MenuCLI.displayMenu(ModelsManagerMenu,{props : {expanded : -1}})
          } else {
            MenuCLI.displayMenu(ModelsManagerMenu,{props : {expanded : i}})
          }
        }})
      }

      if(expanded == i){
        let exp_array = [{
          name : (e.type == 'external') ? ColorText.green('Internal Save') : ColorText.red('Remove'),
          action : async () => {
            if(e.type == 'external'){
              const file = getFileInstance(e.path)
              const moveInstead = ConfigManager.getKey("models.moveInsteadOfCopy") || false
              const fileName = e.model
              const fileSize = e.size
              const originalPath = e.path
              
              if (moveInstead) {
                // MOVE: Remove from external list first
                const modelIndex = models_array.findIndex(m => m.path === originalPath && m.type === 'external')
                if (modelIndex !== -1) {
                  models_array.splice(modelIndex, 1)
                }
                
                // Move the file (with cross-device fallback)
                try {
                  await file.move(`${process.env.PWD}/models`)
                } catch (error) {
                  if (error.code === 'EXDEV') {
                    // Cross-device move: copy then delete
                    await file.copy(`${process.env.PWD}/models`)
                    await file.delete()
                  } else {
                    throw error
                  }
                }
                
                // Store the original path in ConfigManager
                const movedModelsMap = ConfigManager.getKey("models.movedFrom") || {}
                movedModelsMap[fileName] = originalPath
                ConfigManager.setKey("models.movedFrom", movedModelsMap)
                
                // Add to loaded list in correct size order
                const newLoadedModel = {
                  type: 'loaded',
                  model: fileName,
                  size: fileSize,
                  path: `${process.env.PWD}/models/${fileName}`,
                  originalPath: originalPath
                }
                insertModelBySize(models_array, newLoadedModel)
              } else {
                // COPY: Keep external model in array, just copy the file
                await file.copy(`${process.env.PWD}/models`)
                
                // Add to loaded list in correct size order
                const newLoadedModel = {
                  type: 'loaded',
                  model: fileName,
                  size: fileSize,
                  path: `${process.env.PWD}/models/${fileName}`
                }
                insertModelBySize(models_array, newLoadedModel)
              }
              
              // Refresh the display without full filesystem scan
              MenuCLI.displayMenu(ModelsManagerMenu,{props : {expanded : -1, refresh : false}})
            } else {
              // Remove loaded model
              const file = getFileInstance(e.path)
              const fileName = e.model
              
              await file.delete()
              
              // Remove from ConfigManager mapping if it exists
              const movedModelsMap = ConfigManager.getKey("models.movedFrom") || {}
              if (movedModelsMap[fileName]) {
                delete movedModelsMap[fileName]
                ConfigManager.setKey("models.movedFrom", movedModelsMap)
              }
              
              // Remove from loaded list
              const modelIndex = models_array.findIndex(m => m.path === e.path && m.type === 'loaded')
              if (modelIndex !== -1) {
                models_array.splice(modelIndex, 1)
              }
              
              MenuCLI.displayMenu(ModelsManagerMenu,{props : {expanded : -1, refresh : false}})
            }
          }
        }]

        // Add "Move to Original Location" button for loaded models that have an originalPath
        if(e.type == 'loaded' && e.originalPath) {
          exp_array.push({
            name : ColorText.yellow('Move to Original Location'),
            action : async () => {
              const file = getFileInstance(e.path)
              const fileName = e.model
              const fileSize = e.size
              const originalPath = e.originalPath
              
              // Remove from loaded list
              const modelIndex = models_array.findIndex(m => m.path === e.path && m.type === 'loaded')
              if (modelIndex !== -1) {
                models_array.splice(modelIndex, 1)
              }
              
              // Move back to original location (with cross-device fallback)
              const originalDir = originalPath.substring(0, originalPath.lastIndexOf('/'))
              try {
                await file.move(originalDir)
              } catch (error) {
                if (error.code === 'EXDEV') {
                  // Cross-device move: copy then delete
                  await file.copy(originalDir)
                  await file.delete()
                } else {
                  throw error
                }
              }
              
              // Remove from ConfigManager mapping
              const movedModelsMap = ConfigManager.getKey("models.movedFrom") || {}
              if (movedModelsMap[fileName]) {
                delete movedModelsMap[fileName]
                ConfigManager.setKey("models.movedFrom", movedModelsMap)
              }
              
              // Add back to external list in correct size order
              const newExternalModel = {
                type: 'external',
                model: fileName,
                size: fileSize,
                path: originalPath
              }
              insertModelBySize(models_array, newExternalModel)
              
              // Refresh the display
              MenuCLI.displayMenu(ModelsManagerMenu,{props : {expanded : -1, refresh : false}})
            }
          })
        }

        if(e.type == 'external'){
          exp_array.push({
            name : ColorText.red('Remove'),
            action : async () => {
              const file = getFileInstance(e.path)
              const originalPath = e.path
              
              await file.delete()
              
              // Remove from external list
              const modelIndex = models_array.findIndex(m => m.path === originalPath && m.type === 'external')
              if (modelIndex !== -1) {
                models_array.splice(modelIndex, 1)
              }
              
              MenuCLI.displayMenu(ModelsManagerMenu,{props : {expanded : -1, refresh : false}})
            }
          })
        }

        final_array.push(exp_array)
      }
    }
  })

  final_array.push([{
    name : 'Refresh',
    action : async () => {
      await MenuCLI.displayMenu(ModelsManagerMenu,{props : {refresh : true}})
    }
  },
  {
    name : 'Load More',
    action : async () => {
      await MenuCLI.displayMenu(ModelsManagerMenu,{props : {loadmore : true}})
    }
  }])

  // Toggle button for move/copy behaviour
  const moveInstead = ConfigManager.getKey("models.moveInsteadOfCopy") || false
  final_array.push({
    name : `Toggle: ${moveInstead ? ColorText.brightCyan('Move') : ColorText.brightGreen('Copy')} (Internal Save)`,
    action : async () => {
      ConfigManager.setKey("models.moveInsteadOfCopy", !moveInstead)
      await MenuCLI.displayMenu(ModelsManagerMenu, {props : config})
    }
  })

  final_array.push({
    name : '← Back',
    action : () => {
      MenuCLI.displayMenu(MiscMenu)
    }
  })

  return final_array
}

const ModelsManagerMenu = async (props) => {
  let obj_final = {
    title : '• Settings / Misc / Models Manager',
    options : await options_array(props)
  }
  return obj_final
}
// --------------------------------------------------

const MiscMenu = async () => ({
  title : `• Settings / Misc`,
  options : [
    {
      name : 'Models Manager',
      action : async () => {
        await MenuCLI.displayMenu(ModelsManagerMenu,{props : {reset_loadcount : true}})
      }
    },
    {
      name : 'Data Manager',
      action : () => {
        MenuCLI.displayMenu(MiscMenu)
      }
    },
    {
      name : `${ColorText.red('Uninstall')} (${ColorText.yellow(getProjectVersion())})`,
      action : () => {
        MenuCLI.displayMenu(MiscMenu)
      }
    },
    {
      name : `${ColorText.brightRed('Exit HUD')}`,
      action : () => {
        console.clear()
        process.exit()
      }
    },
    {
      name : '← Back',
      action : () => {
        MenuCLI.displayMenu(SettingsMenu)
      }
    }
  ]
})

export default MiscMenu