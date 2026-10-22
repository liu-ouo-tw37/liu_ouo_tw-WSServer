function candidate(width, height) {
    const grid = Array.from({ length: width }, () => Array.from({ length: height }, () => ({ visited: false, right: false, down: false })));
    const frontier = [];
    const neighbors = (x, z) => [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]].filter(([nx, nz]) => nx >= 0 && nz >= 0 && nx < width && nz < height);
    const visit = (x, z) => {
        grid[x][z].visited = true;
        for (const [nx, nz] of neighbors(x, z)) if (!grid[nx][nz].visited) frontier.push([x, z, nx, nz]);
    };
    visit(Math.floor(Math.random() * width), Math.floor(Math.random() * height));
    while (frontier.length) {
        const index = Math.floor(Math.random() * frontier.length);
        const [x, z, nx, nz] = frontier[index];
        frontier[index] = frontier[frontier.length - 1];
        frontier.pop();
        if (grid[nx][nz].visited) continue;
        if (nx !== x) grid[Math.min(x, nx)][z].right = true;
        else grid[x][Math.min(z, nz)].down = true;
        visit(nx, nz);
    }
    const connected = (x, z) => neighbors(x, z).filter(([nx, nz]) => nx !== x ? grid[Math.min(x, nx)][z].right : grid[x][Math.min(z, nz)].down);
    const queue = [[0, 0]], parents = new Map([["0,0", null]]);
    for (let index = 0; index < queue.length; index++) {
        const [x, z] = queue[index];
        for (const point of connected(x, z)) {
            const key = point.join(",");
            if (!parents.has(key)) { parents.set(key, [x, z]); queue.push(point); }
        }
    }
    let length = 0, choices = 0;
    for (let point = [width - 1, height - 1]; point; point = parents.get(point.join(","))) {
        length++;
        choices += Math.max(0, connected(...point).length - 2);
    }
    return { grid, score: length + choices * 6 };
}

function mazeLayout(width, height) {
    let best;
    for (let attempt = 0; attempt < 8; attempt++) {
        const next = candidate(width, height);
        if (!best || next.score > best.score) best = next;
    }
    return best.grid;
}

module.exports = mazeLayout;
