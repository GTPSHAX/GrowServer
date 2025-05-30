import { randomInt } from "crypto";
import { TileFlags, Y_END_DIRT, Y_LAVA_START, Y_START_DIRT } from "../../Constants";
import { Block, WorldData } from "../../types";
import { WorldGen } from "../WorldGen";

const cnf = {
  width:  250,
  height: 50,
  grass:  {
    land: [16, 880, 954, 188, 190, 192, 194],
    sea:  [846, 3584]
  },
  tree: {
    seeds: [4585, 243, 407, 5667, 341]
  },
  temple: {
    config:     { width: 11, height: 8, style: 'temple' } as StructureConfig,
    door:       [224], // House Entrance
    walls:      [8652], // Bountiful Jungle Temple Background
    floor:      [8646], // Bountiful Jungle Temple
    pillars:    [8664], // Bountiful Jungle Temple Pillar
    roof:       [8646], // Bountiful Jungle Temple
    steps:      [8646, 8652], // Bountiful Jungle Temple, Bountiful Jungle Temple Background
    statues:    [988, 714], // Gargoyle, Olmec Head
    torches:    [696], // Torch
    ornaments:  [8646, 8652, 8694, 8706], // Bountiful Jungle Temple, Bountiful Jungle Temple Background, Bountiful White Doll's Eyes, Bountiful Corpse Flower
    entrance:   [8658], // Bountiful Jungle Temple Door
    foundation: [8664], // Bountiful Jungle Temple Pillar
    bonus:      {
      block:   [120], // Mystery Block
      dropped: [[242, 10], [2, 20]]
    }
  },
  castle: {
    config:     { width: 11, height: 7, style: 'castle' } as StructureConfig,
    walls:      [104], // Rock background
    floor:      [336], // Stone wall
    windows:    [54, 56], // Window, Glass Pane
    gates:      [684, 686], // Iron Bars, Jail Door
    towers:     [682, 116], // Blackrock Wall, Bricks
    flags:      [860], // Wrought-Iron Fence
    decoration: [988, 696], // Gargoyle, Torch
    foundation: [336], // Stoqne wall
    bonus:      {
      block:   [120], // Mystery Block
      dropped: [[242, 10], [2, 20]]
    }
  },
  house: {
    config:     { width: 7, height: 4, style: 'house' } as StructureConfig,
    walls:      [52, 118], // Wooden Background, Brick Background
    roof:       [116, 100], // Bricks, Wood Block
    windows:    [54, 58], // Window, Wooden Window
    door:       [224], // House Entrance
    floor:      [102, 100], // Wooden Platform, Wood Block
    chimney:    [116, 248], // Bricks, Evil Bricks
    furniture:  [120, 458], // Mystery Block, Dresser
    decoration: [192, 194], // Bush
    foundation: [102, 100], // Wooden Platform, Wood Block
    bonus:      {
      block:   [120], // Mystery Block
      dropped: [[242, 10], [2, 20]]
    }
  }
};

interface StructureConfig {
  width: number;
  height: number;
  style: 'temple' | 'castle' | 'house';
}

interface TreeConfig {
  trunkHeight: number;
  crownRadius: number;
  isConical?: boolean;
}

interface LeafGeneration {
  euclideanDistance: number;
  dx: number;
  dy: number;
  pass: number;
}

export class Forest extends WorldGen {
  public data: WorldData;
  public width = cnf.width;
  public height = cnf.height;
  public blockCount = this.height * this.width;

  private seed: number;
  private randoms: Record<string, () => number>;

  constructor(public name: string, seed?: number) {
    super(name);

    this.seed = seed ?? this.stringToSeed(name);
    // this.seed = 3139;
    console.info(`Seed: ${this.seed}`);
    this.randoms = this.createRandomGenerators();
    this.data = this.initializeWorldData(name);
  }

  private createRandomGenerators(): Record<string, () => number> {
    const offsets = { terrain: 0, water: 17, tree: 37, grass: 71, general: 113 };
    return Object.fromEntries(
      Object.entries(offsets).map(([key, offset]) => [
        key,
        this.seededRandom((this.seed + offset) % 499 + 1)
      ])
    );
  }

  private initializeWorldData(name: string): WorldData {
    return {
      name,
      width:       this.width,
      height:      this.height,
      blocks:      [],
      admins:      [],
      playerCount: 0,
      jammers:     [],
      dropped:     { uid: 0, items: [] },
      weatherId:   37
    };
  }

  private stringToSeed(str: string): number {
    if (!str.length) return 3000;

    let hash = str.split('').reduce((acc, char) =>
      ((acc << 5) - acc) + char.charCodeAt(0) | 0, 0
    );

    hash = Math.abs(hash) || 3000;
    return ((hash & 0x1FFF) % 10000) + 1;
  }

  private seededRandom(seed: number): () => number {
    let state = seed % 2147483647 || 2147483646;
    return () => (state = (state * 16807) % 2147483647, (state - 1) / 2147483646);
  }

  private noise(x: number, amplitude = 1): number {
    return Math.sin(x * 0.05 * this.seed * 0.001) * amplitude;
  }

  private generateImprovedTerrain(): number[] {
    const terrainHeights = Array.from({ length: this.width }, (_, x) => {
      const height = Math.floor(
        Y_START_DIRT +
        this.noise(x, 3) +
        this.noise(x * 2, 1.5) +
        this.noise(x * 4, 0.5) +
        (this.randoms.terrain() - 0.5)
      );
      return Math.max(Y_START_DIRT - 3, Math.min(Y_START_DIRT + 4, height));
    });

    // Smooth terrain
    for (let i = 1; i < terrainHeights.length - 1; i++) {
      const avg = (terrainHeights[i - 1] + terrainHeights[i] + terrainHeights[i + 1]) / 3;
      terrainHeights[i] = Math.floor((terrainHeights[i] + avg) / 2);
    }

    return terrainHeights;
  }

  private generateWaterBodies(blocks: Block[][], terrainHeights: number[], doorX: number) {
    const waterBodies = Math.floor(this.randoms.water() * 2) + 1;

    for (let w = 0; w < waterBodies; w++) {
      const centerX = this.findWaterPosition(doorX);
      if (centerX === -1) continue;

      const waterWidth = Math.floor(this.randoms.water() * 8) + 6;
      const maxDepth = Math.floor(this.randoms.water() * 3) + 2;

      this.excavateWater(blocks, centerX, waterWidth, maxDepth, terrainHeights);
      this.convertDirtToSandAroundWater(blocks, centerX, waterWidth, terrainHeights);
    }
  }

  private findWaterPosition(doorX: number): number {
    for (let attempts = 0; attempts < 20; attempts++) {
      const centerX = Math.floor(this.randoms.water() * (this.width - 30)) + 15;
      if (Math.abs(centerX - doorX) >= 20) return centerX;
    }
    return -1;
  }

  private excavateWater(blocks: Block[][], centerX: number, waterWidth: number, maxDepth: number, terrainHeights: number[]) {
    const halfWidth = Math.floor(waterWidth / 2);

    for (let x = Math.max(0, centerX - halfWidth); x <= Math.min(this.width - 1, centerX + halfWidth); x++) {
      const surfaceY = terrainHeights[x];
      const distFromCenter = Math.abs(x - centerX);
      const depthHere = Math.max(1, maxDepth - Math.floor(distFromCenter / 2));

      for (let d = 0; d < depthHere; d++) {
        const waterY = surfaceY + d;
        if (waterY < this.height && blocks[waterY]?.[x]) {
          blocks[waterY][x].fg = 0; // Water
          blocks[waterY][x].flags |= TileFlags.WATER; // Water
          blocks[waterY][x].bg = 14;  // Cave background
          terrainHeights[x] = Math.max(terrainHeights[x], waterY + 1);
        }
      }
    }
  }

  private convertDirtToSandAroundWater(blocks: Block[][], centerX: number, waterWidth: number, terrainHeights: number[]) {
    const sandRadius = Math.floor(waterWidth / 2) + 4;

    for (let x = Math.max(0, centerX - sandRadius); x <= Math.min(this.width - 1, centerX + sandRadius); x++) {
      const distFromCenter = Math.abs(x - centerX);
      const sandChance = Math.max(0, 2 - (distFromCenter / sandRadius));

      if (this.randoms.water() < sandChance) {
        const surfaceY = terrainHeights[x];
        for (let y = surfaceY; y < Math.min(surfaceY + 4, this.height); y++) {
          if (blocks[y]?.[x]?.fg === 2) blocks[y][x].fg = 442; // Convert dirt to sand
        }
      }
    }
  }

  private generateTrees(blocks: Block[][], terrainHeights: number[], doorX: number) {
    for (let x = 5; x < this.width - 5; x += Math.floor(this.randoms.tree() * 5) + 3) {
      if (Math.abs(x - doorX) < 8) continue;

      const surfaceY = terrainHeights[x];
      if (!this.isValidTreeLocation(blocks, x, surfaceY)) continue;

      if (this.randoms.tree() > 0.15) {
        const treeType = this.randoms.tree();

        if (treeType < 0.5) {
          this.generateSpecialTree(blocks, x, surfaceY);
        } else if (treeType < 0.75) {
          this.generateStandardTree(blocks, x, surfaceY, this.getOakConfig());
        } else {
          this.generateStandardTree(blocks, x, surfaceY, this.getPineConfig());
        }
      }
    }
  }

  private isValidTreeLocation(blocks: Block[][], x: number, surfaceY: number): boolean {
    if (surfaceY < 0 || surfaceY >= this.height || !blocks[surfaceY]?.[x]) return false;

    const surfaceBlock = blocks[surfaceY][x];
    if (![2, 442].includes(surfaceBlock.fg)) return false; // Not on dirt or sand

    // Check for water nearby
    for (let checkX = x - 2; checkX <= x + 2; checkX++) {
      if (checkX < 0 || checkX >= this.width) continue;
      for (let checkY = surfaceY - 5; checkY <= surfaceY; checkY++) {
        if (checkY >= 0 && blocks[checkY]?.[checkX]?.fg === 822) return false;
      }
    }

    return true;
  }

  private getOakConfig(): TreeConfig {
    return {
      trunkHeight: Math.floor(this.randoms.tree() * 4) + 5,
      crownRadius: 4,
      isConical:   false
    };
  }

  private getPineConfig(): TreeConfig {
    return {
      trunkHeight: Math.floor(this.randoms.tree() * 5) + 6,
      crownRadius: 4,
      isConical:   true
    };
  }

  private generateSpecialTree(blocks: Block[][], centerX: number, surfaceY: number) {
    const treeY = surfaceY - 1;
    if (treeY >= 0 && blocks[treeY]?.[centerX]?.fg === 0 && !(blocks[treeY]?.[centerX]?.flags & TileFlags.WATER) && blocks[treeY + 1]?.[centerX]?.fg === 2) {
      blocks[treeY][centerX].fg = cnf.tree.seeds[randomInt(cnf.tree.seeds.length)]; // Tree block
    }

    // Add grass around base
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0) continue;
      const grassX = centerX + dx;
      if (grassX >= 0 && grassX < this.width &&
        blocks[surfaceY - 1]?.[grassX]?.fg === 0 &&
        [2, 442].includes(blocks[surfaceY]?.[grassX]?.fg) &&
        this.randoms.tree() > 0.6) {
        blocks[surfaceY - 1][grassX].fg = blocks[surfaceY - 1][grassX].flags & TileFlags.WATER ?
          cnf.grass.sea[randomInt(cnf.grass.sea.length)] :
          cnf.grass.land[randomInt(cnf.grass.land.length)]; // Grass block
      }
    }
  }

  private generateStandardTree(blocks: Block[][], centerX: number, surfaceY: number, config: TreeConfig) {
    this.generateTrunk(blocks, centerX, surfaceY, config.trunkHeight);
    const leafPositions = this.generateCrown(blocks, centerX, surfaceY - config.trunkHeight, config);
    this.generateHangingRoots(blocks, leafPositions);
  }

  private generateTrunk(blocks: Block[][], centerX: number, surfaceY: number, trunkHeight: number) {
    for (let y = surfaceY - 1; y > surfaceY - trunkHeight - 1 && y >= 0; y--) {
      if (blocks[y]?.[centerX]?.fg === 0) {
        blocks[y][centerX].fg = 1102; // Log
      }
    }
  }

  private generateCrown(blocks: Block[][], centerX: number, crownCenter: number, config: TreeConfig): Array<{ x: number, y: number }> {
    const leafPositions: Array<{ x: number, y: number }> = [];

    const neighbors = [
      [-1, 0], [1, 0], [0, -1], [0, 1], // Cardinals
      [-1, -1], [-1, 1], [1, -1], [1, 1], // Diagonals
      [-1, 0], [1, 0], // These are repeated in your original code
      [-1, -1], [-1, 1], [1, -1], [1, 1] // These are repeated in your original code
    ];

    for (let pass = 0; pass < 2; pass++) {
      for (let dy = -config.crownRadius; dy <= config.crownRadius + 1; dy++) {
        for (let dx = -config.crownRadius; dx <= config.crownRadius; dx++) {
          const leafY = crownCenter + dy;
          const leafX = centerX + dx;

          if (!this.isValidLeafPosition(blocks, leafX, leafY)) continue;

          const leafChance = this.calculateLeafChance({ euclideanDistance: Math.sqrt(dx * dx + dy * dy), dx, dy, pass }, config);

          if (this.randoms.tree() < leafChance) {
            // avoud flying leaves
            if (neighbors.every(([dy, dx]) => blocks[leafY + dy]?.[leafX + dx]?.fg === 0)) {
              continue;
            }

            blocks[leafY][leafX].fg = randomInt(4) == 3 ? 1004 : 1104; // Leaf
            leafPositions.push({ x: leafX, y: leafY });
          }
        }
      }
    }

    return leafPositions;
  }

  private isValidLeafPosition(blocks: Block[][], x: number, y: number): boolean {
    return y >= 0 && y < this.height && x >= 0 && x < this.width && blocks[y]?.[x]?.fg === 0;
  }

  private calculateLeafChance(gen: LeafGeneration, config: TreeConfig): number {
    let leafChance = 0;

    if (config.isConical) {
      leafChance = this.calculatePineLeafChance(gen, config);
    } else {
      leafChance = this.calculateOakLeafChance(gen, config);
    }

    // Common modifiers
    leafChance += this.getCommonLeafModifiers(gen);

    // Second pass adjustment
    if (gen.pass === 1) {
      leafChance *= config.isConical ? 0.5 : 0.6;
    }

    return Math.max(0, Math.min(1, leafChance));
  }

  private calculateOakLeafChance(gen: LeafGeneration, config: TreeConfig): number {
    const { euclideanDistance, dx, dy } = gen;
    const manhattanDistance = Math.abs(dx) + Math.abs(dy);

    let chance = 0;
    if (euclideanDistance <= 1.5) chance = 0.98;
    else if (euclideanDistance <= 2.5) chance = 0.85 - (euclideanDistance - 1.5) * 0.2;
    else if (euclideanDistance <= 3.5) chance = 0.65 - (euclideanDistance - 2.5) * 0.25;
    else if (euclideanDistance <= 4.5) chance = 0.35 - (euclideanDistance - 3.5) * 0.2;

    // Branch-like extensions
    if (manhattanDistance <= 2 && (Math.abs(dx) === manhattanDistance || Math.abs(dy) === manhattanDistance)) {
      chance *= 1.3;
    }

    // Asymmetry
    if (dx > 0) chance *= 0.95;
    if (dy < -1) chance *= 1.15;
    if (dy > 1) chance *= 1.05;

    return chance;
  }

  private calculatePineLeafChance(gen: LeafGeneration, config: TreeConfig): number {
    const { euclideanDistance, dx, dy } = gen;

    const heightRatio = (dy + config.crownRadius) / (config.crownRadius * 2);
    const allowedRadius = 0.5 + heightRatio * 3.5;

    if (euclideanDistance > allowedRadius) return 0;

    let chance = 0;
    const relativeDistance = euclideanDistance / allowedRadius;

    if (relativeDistance <= 0.4) chance = 0.95;
    else if (relativeDistance <= 0.7) chance = 0.85;
    else if (relativeDistance <= 0.9) chance = 0.7;
    else chance = 0.5;

    // Pine-specific modifiers
    if (Math.abs(dx) <= 1) chance *= 1.3;
    if (dy > 0) chance *= 1.15;
    if (dy < -2) chance *= 1.1;

    return chance;
  }

  private getCommonLeafModifiers(gen: LeafGeneration): number {
    const { dx, dy } = gen;
    const positionNoise = Math.sin(dx * 0.7) * Math.cos(dy * 0.5) * 0.15;
    const secondaryNoise = Math.sin(dx * 1.3) * Math.cos(dy * 0.8) * 0.1;
    const clusterNoise = (this.randoms.tree() - 0.5) * 0.4;

    return positionNoise + secondaryNoise + clusterNoise;
  }

  private generateHangingRoots(blocks: Block[][], leafPositions: Array<{ x: number, y: number }>) {
    leafPositions.forEach(leaf => {
      if (this.randoms.tree() <= 0.5) return;

      const rootLength = Math.floor(this.randoms.tree() * 3) + 1;

      for (let r = 1; r <= rootLength; r++) {
        const rootY = leaf.y + r;
        if (rootY >= this.height || blocks[rootY]?.[leaf.x]?.fg !== 0) break;

        blocks[rootY][leaf.x].fg = 8934; // Hanging root
        if (this.randoms.tree() > 0.6) break;
      }
    });
  }

  private generateGrass(blocks: Block[][], terrainHeights: number[]) {
    terrainHeights.forEach((surfaceY, x) => {
      if (surfaceY - 1 >= 0 &&
        [2, 442].includes(blocks[surfaceY]?.[x]?.fg) &&
        blocks[surfaceY - 1]?.[x]?.fg === 0 &&
        this.randoms.grass() > 0.25) {
        blocks[surfaceY - 1][x].fg = blocks[surfaceY - 1][x].flags & TileFlags.WATER?
          cnf.grass.sea[randomInt(cnf.grass.sea.length)] :
          cnf.grass.land[randomInt(cnf.grass.land.length)]; // Grass block
      }
    });
  }

  private generateStructure(blocks: Block[][], x: number, y: number, type: 'house' | 'castle' | 'temple') {
    console.log(`Generating structure: ${type} at ${x}, ${y}`);
    
    switch (type) {
      case 'temple':
        this.generateTemple(blocks, x, y, cnf.temple.config);
        break;
      case 'castle':
        this.generateEnhancedCastle(blocks, x, y, cnf.castle.config);
        break;
      case 'house':
        this.generateEnhancedHouse(blocks, x, y, cnf.house.config); // Fix: use cnf.house.config
        break;
    }
  }

  private generateTemple(blocks: Block[][], x: number, y: number, config: StructureConfig) {
    const { width, height } = config;
    const halfWidth = Math.floor(width / 2);
    
    // Check foundation
    if (!this.isValidFoundation(blocks, x, y, width)) return;
  
    // Generate steps leading up to temple
    for (let step = 0; step < 3; step++) {
      for (let i = -(halfWidth + 2 - step); i <= (halfWidth + 2 - step); i++) {
        if (blocks[y + step]?.[x + i]) {
          blocks[y + step][x + i].fg = this.getRandomBlock(cnf.temple.steps);
        }
      }
    }
  
    // Main structure with pyramid-like shape
    for (let j = 0; j < height; j++) {
      const levelWidth = width - Math.floor(j * 0.5);
      const levelHalfWidth = Math.floor(levelWidth / 2);
      
      for (let i = -levelHalfWidth; i <= levelHalfWidth; i++) {
        if (blocks[y - j]?.[x + i]) {
          // Columns at periodic intervals
          if (i % 3 === 0 && j < height - 1) {
            blocks[y - j][x + i].fg = this.getRandomBlock(cnf.temple.pillars);
          }
          // Walls with varied patterns
          else {
            const isEdge = Math.abs(i) === levelHalfWidth;
            const isTop = j === height - 1;
            blocks[y - j][x + i].fg = isEdge || isTop ? 
              this.getRandomBlock(cnf.temple.ornaments) : 
              this.getRandomBlock(cnf.temple.walls);
          }
        }
      }
    }
  
    // Add decorative elements
    this.addTempleDecorations(blocks, x, y, width, height);
    
    // Generate bonus items
    this.generateBuildingBonus(blocks, x, y, 'temple');
  }  
  
  private addTempleDecorations(blocks: Block[][], x: number, y: number, width: number, height: number) {
    const halfWidth = Math.floor(width / 2);
  
    // Central statue
    if (blocks[y - 2]?.[x]) {
      blocks[y - 2][x].fg = this.getRandomBlock(cnf.temple.statues);
    }
  
    // Torches with random placement
    for (let i = -halfWidth + 1; i <= halfWidth - 1; i += 2) {
      if (this.randoms.general() > 0.5 && blocks[y - 3]?.[x + i]) {
        blocks[y - 3][x + i].fg = cnf.temple.torches[0];
      }
    }
  
    // Entrance with ornate design
    if (blocks[y - 1]?.[x]) {
      blocks[y - 1][x].fg = cnf.temple.entrance[0];
      // Add entrance decorations
      if (blocks[y - 2]?.[x - 1]) blocks[y - 2][x - 1].fg = this.getRandomBlock(cnf.temple.ornaments);
      if (blocks[y - 2]?.[x + 1]) blocks[y - 2][x + 1].fg = this.getRandomBlock(cnf.temple.ornaments);
    }
  }

  private generateEnhancedCastle(blocks: Block[][], x: number, y: number, config: StructureConfig) {
    const { width, height } = config;
    const halfWidth = Math.floor(width / 2);
  
    // Check foundation
    if (!this.isValidFoundation(blocks, x, y, width)) return;
  
    // Generate foundation
    for (let i = -halfWidth - 1; i <= halfWidth + 1; i++) {
      for (let j = 0; j < 2; j++) {
        if (blocks[y + j]?.[x + i]) {
          blocks[y + j][x + i].fg = this.getRandomBlock(cnf.castle.foundation);
        }
      }
    }
  
    // Main keep with irregular shape
    for (let j = 0; j < height; j++) {
      const irregularity = Math.floor(this.randoms.general() * 2);
      const levelWidth = width + irregularity;
      const levelHalfWidth = Math.floor(levelWidth / 2);
  
      for (let i = -levelHalfWidth; i <= levelHalfWidth; i++) {
        if (blocks[y - j]?.[x + i]) {
          // Tower sections
          if (i === -levelHalfWidth || i === levelHalfWidth) {
            blocks[y - j][x + i].fg = this.getRandomBlock(cnf.castle.towers);
          }
          // Windows with random placement
          else if (j % 2 === 1 && this.randoms.general() > 0.7) {
            blocks[y - j][x + i].fg = this.getRandomBlock(cnf.castle.windows);
          }
          // Walls with varied materials
          else {
            blocks[y - j][x + i].fg = this.getRandomBlock(cnf.castle.walls);
          }
        }
      }
    }
  
    this.addCastleDecorations(blocks, x, y, width, height);
    
    // Generate bonus items
    this.generateBuildingBonus(blocks, x, y, 'castle');
  }
  
  private generateEnhancedHouse(blocks: Block[][], x: number, y: number, config: StructureConfig) {
    const { width, height } = config;
    const halfWidth = Math.floor(width / 2);
  
    console.log(`Generating house at ${x}, ${y} with size ${width}x${height}`);
  
    // Foundation and floor
    for (let i = -halfWidth; i <= halfWidth; i++) {
      if (blocks[y]?.[x + i]) {
        blocks[y][x + i].fg = this.getRandomBlock(cnf.house.foundation);
      }
    }
  
    // Walls and windows
    for (let j = 1; j < height; j++) {
      for (let i = -halfWidth; i <= halfWidth; i++) {
        if (blocks[y - j]?.[x + i]) {
          // Corner walls
          if (i === -halfWidth || i === halfWidth) {
            blocks[y - j][x + i].fg = this.getRandomBlock(cnf.house.walls);
          }
          // Windows
          else if (j === 2 && i !== 0 && Math.abs(i) > 1) {
            blocks[y - j][x + i].fg = this.getRandomBlock(cnf.house.windows);
          }
          // Interior walls
          else if (i === -halfWidth || i === halfWidth) {
            blocks[y - j][x + i].fg = this.getRandomBlock(cnf.house.walls);
          }
        }
      }
    }
  
    // Roof
    for (let i = -(halfWidth + 1); i <= halfWidth + 1; i++) {
      if (blocks[y - height]?.[x + i]) {
        blocks[y - height][x + i].fg = this.getRandomBlock(cnf.house.roof);
      }
    }
  
    // Door
    if (blocks[y - 1]?.[x]) {
      blocks[y - 1][x].fg = this.getRandomBlock(cnf.house.door);
    }
  
    // Interior decoration
    if (blocks[y - 1]?.[x - 1] && this.randoms.general() > 0.5) {
      blocks[y - 1][x - 1].fg = this.getRandomBlock(cnf.house.furniture);
    }
    
    // Generate bonus items
    this.generateBuildingBonus(blocks, x, y, 'house');
  }
  
  private addCastleDecorations(blocks: Block[][], x: number, y: number, width: number, height: number) {
    const halfWidth = Math.floor(width / 2);
  
    // Add battlements with varying heights
    for (let i = -halfWidth; i <= halfWidth; i++) {
      const heightVar = Math.floor(this.randoms.general() * 2);
      if (blocks[y - height - heightVar]?.[x + i]) {
        blocks[y - height - heightVar][x + i].fg = i % 2 === 0 ? 
          this.getRandomBlock(cnf.castle.towers) : 0;
      }
    }
  
    // Add flags and decorations
    [-halfWidth, halfWidth].forEach(offset => {
      if (blocks[y - height + 1]?.[x + offset]) {
        blocks[y - height + 1][x + offset].fg = cnf.castle.flags[0];
      }
      // Add torches near the towers
      if (blocks[y - Math.floor(height/2)]?.[x + offset]) {
        blocks[y - Math.floor(height/2)][x + offset].fg = cnf.castle.decoration[1];
      }
    });
  
    // Grand entrance
    if (blocks[y - 1]?.[x]) {
      blocks[y - 1][x].fg = this.getRandomBlock(cnf.castle.gates);
    }
  }

  private getRandomBlock(blocks: number[]): number {
    return blocks[Math.floor(this.randoms.general() * blocks.length)];
  }
  
  private isValidFoundation(blocks: Block[][], x: number, y: number, width: number): boolean {
    const halfWidth = Math.floor(width / 2);
    // Check if there's solid ground BELOW the structure (y+1, not y-1)
    for (let i = -halfWidth - 1; i <= halfWidth + 1; i++) {
      const checkX = x + i;
      const checkY = y + 1; // Check the ground below
      
      if (checkX < 0 || checkX >= this.width || checkY >= this.height) {
        return false;
      }
      
      if (!blocks[checkY]?.[checkX]) {
        return false;
      }
      
      const block = blocks[checkY][checkX];
      // Must be solid ground (dirt, stone, etc) - not air, water, or decorative items
      if (block.fg === 0 || 
          block.flags & TileFlags.WATER ||
          cnf.grass.land.includes(block.fg) ||
          cnf.grass.sea.includes(block.fg) ||
          cnf.tree.seeds.includes(block.fg)) {
        return false;
      }
    }
    return true;
  }
  
  private smoothTerrain(terrainHeights: number[], startX: number, width: number): void {
    const endX = startX + width;
    for (let x = startX; x < endX; x++) {
      if (x > 0 && x < terrainHeights.length - 1) {
        const avg = (terrainHeights[x-1] + terrainHeights[x] + terrainHeights[x+1]) / 3;
        terrainHeights[x] = Math.floor(avg);
      }
    }
  }

  private generateBiomes(blocks: Block[][], terrainHeights: number[]) {
    const biomeWidth = 50;
    const randomBlocks = [1104, 826, 13202, 1004, 7374];
  
    for (let i = 0; i < this.width; i += biomeWidth) {
      const biomeRand = this.randoms.general();
      const biomeType = Math.floor(biomeRand * 3);
      const biomeStart = i;
      const biomeEnd = Math.min(i + biomeWidth, this.width);
      
      console.log(`Biome ${biomeType} at ${biomeStart} to ${biomeEnd} random ${biomeRand}`);
  
      if (biomeType === 0) { // Plains
        this.generatePlains(blocks, biomeStart, biomeEnd, terrainHeights, randomBlocks);
        if (this.randoms.general() > 0.7) { // Increased chance
          this.tryGenerateStructure(blocks, biomeStart, biomeEnd, terrainHeights, 'house');
        }
      } else if (biomeType === 1) { // Hills
        this.generateHills(blocks, biomeStart, biomeEnd, terrainHeights);
        if (this.randoms.general() > 0.8) { // Increased chance
          this.tryGenerateStructure(blocks, biomeStart, biomeEnd, terrainHeights, 'castle');
        }
      } else { // Desert/Temple biome
        this.generatePlains(blocks, biomeStart, biomeEnd, terrainHeights, randomBlocks);
        if (this.randoms.general() > 0.8) { // Increased chance
          this.tryGenerateStructure(blocks, biomeStart, biomeEnd, terrainHeights, 'temple');
        }
      }
    }
  }
  
  private generateBuildingBonus(blocks: Block[][], x: number, y: number, type: 'house' | 'castle' | 'temple') {
    const config = cnf[type].config;
    const bonus = cnf[type].bonus;
    const halfWidth = Math.floor(config.width / 2);
    
    console.log(`Generating bonus items for ${type} at ${x}, ${y}`);
    
    // Generate bonus blocks (like mystery blocks)
    if (bonus.block && this.randoms.general() > 0.3) {
      const bonusBlock = this.getRandomBlock(bonus.block);
      const bonusPos = this.findRandomInteriorPosition(blocks, x, y, config, 'block');
      
      if (bonusPos) {
        console.log(`Placing bonus block ${bonusBlock} at ${bonusPos.x}, ${bonusPos.y}`);
        blocks[bonusPos.y][bonusPos.x].fg = bonusBlock;
      }
    }
    
    // Generate dropped items
    if (bonus.dropped && this.randoms.general() > 0.4) {
      const droppedItem = bonus.dropped[Math.floor(this.randoms.general() * bonus.dropped.length)];
      const dropPos = this.findRandomInteriorPosition(blocks, x, y, config, 'drop');
      
      if (dropPos && droppedItem) {
        console.log(`Placing dropped item [${droppedItem[0]}, ${droppedItem[1]}] at ${dropPos.x}, ${dropPos.y}`);
        
        // Add to world's dropped items
        if (this.data.dropped) {
          this.data.dropped.items = [];
        }
        
        this.data.dropped?.items?.push({
          id:     droppedItem[0],
          amount: droppedItem[1],
          block:  {
            x: dropPos.x,
            y: dropPos.y
          },
          x:   dropPos.x,
          y:   dropPos.y,
          uid: this.data.dropped?.items?.length || 0
        });
      }
    }
  }

  private findRandomInteriorPosition(blocks: Block[][], centerX: number, centerY: number, config: StructureConfig, itemType: 'block' | 'drop'): {x: number, y: number} | null {
    const halfWidth = Math.floor(config.width / 2);
    const maxAttempts = config.width * config.height;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Generate random position within building bounds
      const offsetX = Math.floor(this.randoms.general() * (config.width - 2)) - halfWidth + 1; // Avoid walls
      const offsetY = Math.floor(this.randoms.general() * (config.height - 1)) + 1; // Avoid roof
      
      const checkX = centerX + offsetX;
      const checkY = centerY - offsetY;
      
      // Validate position bounds
      if (checkX < 0 || checkX >= this.width || checkY < 0 || checkY >= this.height) {
        continue;
      }
      
      if (!blocks[checkY] || !blocks[checkY][checkX]) {
        continue;
      }
      
      const targetBlock = blocks[checkY][checkX];
      const blockBelow = blocks[checkY + 1]?.[checkX];
      
      if (itemType === 'block') {
        // For blocks, need empty space with solid ground below
        if (targetBlock.fg === 0 && blockBelow && blockBelow.fg !== 0) {
          return { x: checkX, y: checkY };
        }
      } else if (itemType === 'drop') {
        // For dropped items, need floor space (can be on any solid block)
        if (targetBlock.fg === 0 && blockBelow && blockBelow.fg !== 0) {
          return { x: checkX, y: checkY };
        }
      }
    }
    
    console.log(`Failed to find interior position for ${itemType} in building at ${centerX}, ${centerY}`);
    return null;
  }

  private generatePlains(blocks: Block[][], biomeStart: number, biomeEnd: number, terrainHeights: number[], randomBlocks: number[]) {
    for (let x = biomeStart; x < biomeEnd; x++) {
      for (let y = terrainHeights[x]; y < terrainHeights[x] + 5 && y < this.height; y++) {
        if (blocks[y]?.[x]) {
          blocks[y][x].fg = this.randoms.general() > 0.2 ? 2 : randomBlocks[randomInt(randomBlocks.length)];
        }
      }
    }
  }

  private generateHills(blocks: Block[][], biomeStart: number, biomeEnd: number, terrainHeights: number[]) {
    for (let x = biomeStart; x < biomeEnd; x++) {
      if (this.randoms.general() > 0.5) {
        for (let y = terrainHeights[x]; y < terrainHeights[x] + 7 && y < this.height; y++) {
          if (blocks[y]?.[x]) {
            blocks[y][x].fg = this.randoms.general() > 0.5 ? 10 : 2;
          }
        }
      }
    }
  }

  private tryGenerateStructure(blocks: Block[][], biomeStart: number, biomeEnd: number, terrainHeights: number[], type: 'house' | 'castle' | 'temple') {
    const structureConfig = cnf[type].config;
    const minSpace = structureConfig.width + 8; // More padding
    
    // Ensure we have enough space in the biome
    if (biomeEnd - biomeStart < minSpace) {
      console.log(`Not enough space for ${type} in biome ${biomeStart}-${biomeEnd}`);
      return;
    }
    
    // Find suitable location with multiple attempts
    for (let attempt = 0; attempt < 5; attempt++) {
      const structureX = biomeStart + Math.floor(this.randoms.general() * (biomeEnd - biomeStart - minSpace)) + Math.floor(minSpace/2);
      
      // Make sure we're not too close to edges
      if (structureX < structureConfig.width/2 || structureX > this.width - structureConfig.width/2) {
        continue;
      }
      
      const structureY = terrainHeights[structureX] - 1; // Place structure ON the ground, not IN it
      
      console.log(`Attempting to place ${type} at ${structureX}, ${structureY}`);
      
      // Smooth the terrain around the structure
      this.smoothTerrain(terrainHeights, structureX - Math.floor(minSpace/2), minSpace);
      
      // Check if foundation is valid
      if (this.isValidFoundation(blocks, structureX, structureY, structureConfig.width)) {
        console.log(`Generating ${type} at ${structureX}, ${structureY}`);
        this.generateStructure(blocks, structureX, structureY, type);
        return; // Success, exit
      } else {
        console.log(`Invalid foundation for ${type} at ${structureX}, ${structureY}`);
      }
    }
    
    console.log(`Failed to place ${type} in biome ${biomeStart}-${biomeEnd} after 5 attempts`);
  }

  public generate(): Promise<void> {
    return new Promise((resolve) => {
      const blocks: Block[][] = Array.from({ length: this.height }, (_, y) =>
        Array.from({ length: this.width }, (_, x) => ({ x, y, fg: 0, bg: 0 }))
      );

      const mainDoorPosition = Math.floor(this.width * 0.25);
      const terrainHeights = this.generateImprovedTerrain();

      // Ensure flat area around door
      for (let i = -10; i <= 5; i++) {
        const pos = mainDoorPosition + i;
        if (pos >= 0 && pos < this.width) {
          terrainHeights[pos] = Y_START_DIRT;
        }
      }

      // Generate underground and surface
      this.generateUnderground(blocks, terrainHeights, mainDoorPosition);
      this.generateBiomes(blocks, terrainHeights);

      // Generate forest features
      this.generateWaterBodies(blocks, terrainHeights, mainDoorPosition);
      this.generateTrees(blocks, terrainHeights, mainDoorPosition);
      this.generateGrass(blocks, terrainHeights);

      // Convert to 1D array
      this.data.blocks = blocks.flat();
      resolve();
    });
  }

  private generateUnderground(blocks: Block[][], terrainHeights: number[], mainDoorPosition: number) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const block = blocks[y][x];
        const surfaceLevel = terrainHeights[x];

        if (block.y === surfaceLevel - 1 && block.x === mainDoorPosition) {
          block.fg = 6;
          block.door = { label: "EXIT", destination: "EXIT" };
        } else if (block.y >= surfaceLevel) {
          if (block.x === mainDoorPosition && block.y === surfaceLevel) {
            block.fg = 8;
          } else if (block.y < Y_END_DIRT) {
            if (block.y >= Y_LAVA_START) {
              const rand = this.randoms.general();
              block.fg = rand > 0.8 ? 4 : rand > 0.3 ? 2 : 10;
            } else {
              block.fg = this.randoms.general() > 0.05 ? 2 : 10;
            }
          } else {
            block.fg = 8;
          }
          block.bg = 14;
        }
      }
    }
  }
}