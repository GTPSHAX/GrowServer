import { randomInt } from "crypto";
import { Y_END_DIRT, Y_LAVA_START, Y_START_DIRT } from "../../Constants";
import { Block, WorldData } from "../../types";
import { WorldGen } from "../WorldGen";

const configuration = {
  grass: [
    16, 880, 954, 188, 190, 192, 194
  ],
  special_seeds: [
    4585, 243, 2735, 427, 5667, 341
  ]
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
  public width = 200;
  public height = 60;
  public blockCount = this.height * this.width;

  private seed: number;
  private randoms: Record<string, () => number>;

  constructor(public name: string, seed?: number) {
    super(name);

    this.seed = seed ?? this.stringToSeed(name);
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
      weatherId:   41
    };
  }

  private stringToSeed(str: string): number {
    if (!str.length) return 1;

    let hash = str.split('').reduce((acc, char) =>
      ((acc << 5) - acc) + char.charCodeAt(0) | 0, 0
    );

    hash = Math.abs(hash) || 1;
    return ((hash & 0x1FFF) % 5000) + 1;
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
          blocks[waterY][x].fg = 822; // Water
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
    if (treeY >= 0 && blocks[treeY]?.[centerX]?.fg === 0) {
      blocks[treeY][centerX].fg = configuration.special_seeds[randomInt(configuration.special_seeds.length)]; // Tree block
    }

    // Add grass around base
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0) continue;
      const grassX = centerX + dx;
      if (grassX >= 0 && grassX < this.width &&
        blocks[surfaceY - 1]?.[grassX]?.fg === 0 &&
        [2, 442].includes(blocks[surfaceY]?.[grassX]?.fg) &&
        this.randoms.tree() > 0.6) {
        blocks[surfaceY - 1][grassX].fg = configuration.grass[randomInt(configuration.grass.length)]; // Grass
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
        blocks[surfaceY - 1][x].fg = configuration.grass[randomInt(0, configuration.grass.length)]; // Grass
      }
    });
  }

  private generateStructure(blocks: Block[][], x: number, y: number, type: 'house' | 'castle') {
    if (type === 'house') {
      this.generateHouse(blocks, x, y);
    } else {
      this.generateCastle(blocks, x, y);
    }
  }

  private generateHouse(blocks: Block[][], x: number, y: number) {
    // Roof
    for (let i = -4; i <= 4; i++) {
      if (blocks[y]?.[x - i]) blocks[y][x - i].fg = 116;
    }

    // Corner roof blocks
    [[-4], [-5], [4], [5]].forEach(([offset]) => {
      if (blocks[y]?.[x + offset]) blocks[y][x + offset].fg = 2;
    });

    // Chimney
    for (let j = 0; j <= 2; j++) {
      if (blocks[y - j]?.[x - 3]) blocks[y - j][x - 3].fg = 116;
    }

    // Walls with windows
    for (let j = 1; j <= 3; j++) {
      for (let i = -3; i <= 3; i++) {
        if (blocks[y - j]?.[x + i]) {
          blocks[y - j][x + i].fg = (Math.abs(i) === 1 && j % 2 === 0) ? 54 : 52;
        }
      }
    }

    // Entrance and foundation
    if (blocks[y - 1]?.[x]) blocks[y - 1][x].fg = 224;
    if (blocks[y - 1]?.[x - 1]) blocks[y - 1][x - 1].fg = 120; // Chest

    for (let i = -3; i <= 3; i++) {
      if (blocks[y - 4]?.[x - i]) blocks[y - 4][x - i].fg = 116;
    }
  }

  private generateCastle(blocks: Block[][], x: number, y: number) {
    // Corner blocks
    [[-4], [-5], [4], [5]].forEach(([offset]) => {
      if (blocks[y]?.[x + offset]) blocks[y][x + offset].fg = 2;
    });

    // Main tower
    for (let i = -3; i <= 3; i++) {
      for (let j = 0; j <= 6; j++) {
        if (blocks[y - j]?.[x - i]) blocks[y - j][x - i].fg = 116;
      }
    }

    // Side towers
    for (let j = 0; j <= 5; j++) {
      if (blocks[y - j]?.[x + 4]) blocks[y - j][x + 4].fg = 116;
      if (blocks[y - j]?.[x - 4]) blocks[y - j][x - 4].fg = 116;
    }

    // Flags and chest
    if (blocks[y - 6]?.[x + 4]) blocks[y - 6][x + 4].fg = 860;
    if (blocks[y - 6]?.[x - 4]) blocks[y - 6][x - 4].fg = 860;
    if (blocks[y - 5]?.[x]) blocks[y - 5][x].fg = 120;

    // Crenellations
    for (let i = -3; i <= 3; i++) {
      if (blocks[y - 7]?.[x - i]) blocks[y - 7][x - i].fg = (i % 2 === 0) ? 116 : 0;
    }

    // Drawbridge and entrance
    for (let i = -1; i <= 1; i++) {
      if (blocks[y]?.[x - i]) blocks[y][x - i].fg = 102;
    }
    if (blocks[y - 1]?.[x]) blocks[y - 1][x].fg = 684;
  }

  private generateBiomes(blocks: Block[][], terrainHeights: number[]) {
    const biomeWidth = 50;
    const randomBlocks = [1104, 826, 13202, 1004, 7374];

    for (let i = 0; i < this.width; i += biomeWidth) {
      const biomeType = Math.floor(this.randoms.general() * 3);
      const biomeStart = i;
      const biomeEnd = Math.min(i + biomeWidth, this.width);

      if (biomeType === 1) { // Plains
        this.generatePlains(blocks, biomeStart, biomeEnd, terrainHeights, randomBlocks);
        if (this.randoms.general() > 0.8) this.tryGenerateStructure(blocks, biomeStart, biomeEnd, terrainHeights, 'house');
      } else if (biomeType === 2) { // Hills
        this.generateHills(blocks, biomeStart, biomeEnd, terrainHeights);
        if (this.randoms.general() > 0.7) this.tryGenerateStructure(blocks, biomeStart, biomeEnd, terrainHeights, 'castle');
      }
    }
  }

  private generatePlains(blocks: Block[][], biomeStart: number, biomeEnd: number, terrainHeights: number[], randomBlocks: number[]) {
    for (let x = biomeStart; x < biomeEnd; x++) {
      for (let y = terrainHeights[x]; y < terrainHeights[x] + 5 && y < this.height; y++) {
        if (blocks[y]?.[x]) {
          blocks[y][x].fg = this.randoms.general() > 0.2 ? 2 : randomBlocks[randomInt(0, randomBlocks.length)];
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

  private tryGenerateStructure(blocks: Block[][], biomeStart: number, biomeEnd: number, terrainHeights: number[], type: 'house' | 'castle') {
    const structureX = biomeStart + Math.floor(this.randoms.general() * (biomeEnd - biomeStart - 5)) + 2;
    const structureY = terrainHeights[structureX] - 1;

    // Check if solid foundation exists
    const isSolid = Array.from({ length: 5 }, (_, i) => structureX + i)
      .every(x => blocks[structureY + 1]?.[x] && ![4585, 16, 0, 822].includes(blocks[structureY + 1][x].fg));

    if (isSolid) {
      this.generateStructure(blocks, structureX, structureY, type);
    }
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