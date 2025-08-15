const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');

module.exports = {
  execute: async (client) => {
    const commands = [];
    const commandCollection = new Collection();
    const basePath = path.join(__dirname);
    
    // Recursive function to load command files
    const loadCommands = (dir) => {
      const files = fs.readdirSync(dir);
      
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
          // Skip utils directories
          if (file === 'utils') continue;
          loadCommands(filePath);
        } else if (file.endsWith('.js') && file !== 'deploy.js' && file !== 'LinkListener.js') {
          const command = require(filePath);
          // Only process files with valid command structure
          if (command.data && command.execute) {
            commands.push(command.data.toJSON());
            commandCollection.set(command.data.name, command);
          }
        }
      }
    };
    
    // Load commands only from src/commands directory
    loadCommands(path.join(basePath, 'src', 'commands'));
    
    try {
      // Register commands globally
      await client.application.commands.set(commands);
      client.commands = commandCollection;
      console.log(`Successfully registered ${commands.length} application commands.`);
    } catch (error) {
      console.error('Error deploying commands:', error);
    }
  }
};