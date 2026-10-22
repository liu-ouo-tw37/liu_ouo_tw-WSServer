async function buildCommands(server, commands, batchSize = 64) {
    for (let index = 0; index < commands.length; index += batchSize) {
        await server.executeCommands(commands.slice(index, index + batchSize));
    }
}

module.exports = buildCommands;
