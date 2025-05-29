import { randomInt } from "crypto";
import { Y_END_DIRT, Y_LAVA_START, Y_START_DIRT } from "../../Constants";
import { Block, WorldData } from "../../types";
import { WorldGen } from "../WorldGen";

export class Forest extends WorldGen {
  public data: WorldData;
  public width: number;
  public height: number;
  public blockCount: number;
  private seed: number;
  private terrainRandom: () => number;
  private waterRandom: () => number;
  private treeRandom: () => number;
  private grassRandom: () => number;
  private generalRandom: () => number;

  constructor(public name: string, seed?: number) {
    super(name);
    this.width = 200;
    this.height = 60;
    this.blockCount = this.height * this.width;
    
    // Minecraft-style seed generation
    this.seed = seed ?? this.stringToSeed(name);
    
    // Create independent random generators for different features with controlled offsets
    this.terrainRandom = this.seededRandom(this.seed);
    this.waterRandom = this.seededRandom((this.seed + 17) % 499 + 1);   // Keep within 1-499
    this.treeRandom = this.seededRandom((this.seed + 37) % 499 + 1);    // Keep within 1-499
    this.grassRandom = this.seededRandom((this.seed + 71) % 499 + 1);   // Keep within 1-499
    this.generalRandom = this.seededRandom((this.seed + 113) % 499 + 1); // Keep within 1-499

    this.data = {
      name,
      width:       this.width,
      height:      this.height,
      blocks:      [],
      admins:      [],
      playerCount: 0,
      jammers:     [],
      dropped:     {
        uid:   0,
        items: []
      },
      weatherId: 41
    };
  }

  // Improved string to seed conversion with better distribution
  private stringToSeed(str: string): number {
    if (str.length === 0) return 1;
    
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash | 0; // Convert to 32-bit integer
    }
    
    // Ensure positive number and limit to max 5000
    hash = Math.abs(hash);
    if (hash === 0) hash = 1;
    
    // Use bitwise AND with 0x1FFF (8191) then modulo 5001 for better distribution
    return ((hash & 0x1FFF) % 5000) + 1;
  }

  // Improved seeded random number generator (Linear Congruential Generator)
  private seededRandom(seed: number): () => number {
    let state = seed % 2147483647;
    if (state <= 0) state += 2147483646;
    
    return () => {
      state = (state * 16807) % 2147483647;
      return (state - 1) / 2147483646;
    };
  }

  // Improved noise generation for terrain using terrain-specific random
  private noise(x: number, amplitude: number = 1): number {
    const freq = 0.05;
    return Math.sin(x * freq * this.seed * 0.001) * amplitude;
  }

  private generateImprovedTerrain(): number[] {
    const terrainHeights: number[] = [];
    const baseHeight = Y_START_DIRT;
    
    for (let x = 0; x < this.width; x++) {
      // Multiple octaves of noise for natural terrain
      const primaryWave = this.noise(x, 3);
      const secondaryWave = this.noise(x * 2, 1.5);
      const detailNoise = this.noise(x * 4, 0.5);
      const randomVariation = (this.terrainRandom() - 0.5) * 1;
      
      const height = Math.floor(
        baseHeight + primaryWave + secondaryWave + detailNoise + randomVariation
      );
      
      // Clamp height to reasonable bounds
      terrainHeights[x] = Math.max(
        Y_START_DIRT - 3, 
        Math.min(Y_START_DIRT + 4, height)
      );
    }
    
    // Smooth terrain to avoid too jagged edges
    for (let i = 1; i < terrainHeights.length - 1; i++) {
      const avg = (terrainHeights[i - 1] + terrainHeights[i] + terrainHeights[i + 1]) / 3;
      terrainHeights[i] = Math.floor((terrainHeights[i] + avg) / 2);
    }
    
    return terrainHeights;
  }

  private generateWaterBodies(blocks: Block[][], terrainHeights: number[], doorX: number) {
    // Generate 1-2 water bodies far from door using water-specific random
    const waterBodies = Math.floor(this.waterRandom() * 2) + 1;
    
    for (let w = 0; w < waterBodies; w++) {
      let centerX: number;
      let attempts = 0;
      
      // Find position far from door
      do {
        centerX = Math.floor(this.waterRandom() * (this.width - 30)) + 15;
        attempts++;
      } while (Math.abs(centerX - doorX) < 20 && attempts < 20);
      
      if (attempts >= 20) continue; // Skip if can't find good position
      
      const waterWidth = Math.floor(this.waterRandom() * 8) + 6; // 6-13 blocks wide
      const maxDepth = Math.floor(this.waterRandom() * 3) + 2; // 2-4 blocks deep
      
      // Create water body with proper depth variation
      for (let x = centerX - Math.floor(waterWidth / 2); 
        x <= centerX + Math.floor(waterWidth / 2) && x < this.width; x++) {
        if (x < 0) continue;
        
        const surfaceY = terrainHeights[x];
        const distFromCenter = Math.abs(x - centerX);
        const depthHere = Math.max(1, maxDepth - Math.floor(distFromCenter / 2));
        
        // Excavate water area properly
        for (let d = 0; d < depthHere; d++) {
          const waterY = surfaceY + d;
          if (waterY < this.height && blocks[waterY] && blocks[waterY][x]) {
            blocks[waterY][x].fg = 822; // Water block
            blocks[waterY][x].bg = 14;  // Cave background
            
            // Update terrain height to prevent floating trees
            terrainHeights[x] = Math.max(terrainHeights[x], waterY + 1);
          }
        }
      }
      
      // Convert dirt to sand around water bodies
      this.convertDirtToSandAroundWater(blocks, centerX, waterWidth, terrainHeights);
    }
  }

  private convertDirtToSandAroundWater(blocks: Block[][], centerX: number, waterWidth: number, terrainHeights: number[]) {
    const sandRadius = Math.floor(waterWidth / 2) + 4; // Extended area around water
    
    for (let x = centerX - sandRadius; x <= centerX + sandRadius && x < this.width; x++) {
      if (x < 0) continue;
      
      const distFromCenter = Math.abs(x - centerX);
      const sandChance = Math.max(0, 2 - (distFromCenter / sandRadius));
      
      if (this.waterRandom() < sandChance) {
        const surfaceY = terrainHeights[x];
        
        // Convert dirt blocks to sand in the area
        for (let y = surfaceY; y < Math.min(surfaceY + 4, this.height); y++) {
          if (blocks[y] && blocks[y][x] && blocks[y][x].fg === 2) { // If it's dirt
            blocks[y][x].fg = 442; // Convert to sand
          }
        }
      }
    }
  }

  private generateTrees(blocks: Block[][], terrainHeights: number[], doorX: number) {
    // Generate trees with proper spacing and avoid water/door areas using tree-specific random
    // Increased tree generation rate by reducing spacing
    for (let x = 5; x < this.width - 5; x += Math.floor(this.treeRandom() * 5) + 3) { // Reduced spacing from 6-13 to 3-7
      // Skip area around door
      if (Math.abs(x - doorX) < 8) continue;
      
      const surfaceY = terrainHeights[x];
      
      // Make sure we're placing on solid ground, not water
      if (surfaceY >= 0 && surfaceY < this.height && 
          blocks[surfaceY] && blocks[surfaceY][x] && 
          (blocks[surfaceY][x].fg === 2 || blocks[surfaceY][x].fg === 442)) { // On dirt or sand
        
        // Check there's no water in the area
        let hasWater = false;
        for (let checkX = x - 2; checkX <= x + 2; checkX++) {
          if (checkX >= 0 && checkX < this.width) {
            for (let checkY = surfaceY - 5; checkY <= surfaceY; checkY++) {
              if (checkY >= 0 && checkY < this.height && 
                  blocks[checkY] && blocks[checkY][checkX] && 
                  blocks[checkY][checkX].fg === 822) {
                hasWater = true;
                break;
              }
            }
          }
          if (hasWater) break;
        }
        
        if (!hasWater && this.treeRandom() > 0.15) { // Increased from 0.25 to 0.15 (85% chance)
          const treeType = this.treeRandom();
          
          if (treeType < 0.5) {
            this.generateSpecialTree(blocks, x, surfaceY);
          } else if (treeType < 0.75) { // Increased oak tree chance
            this.generateOakTree(blocks, x, surfaceY);
          } else {
            this.generatePineTree(blocks, x, surfaceY);
          }
        }
      }
    }
  }

  private generateSpecialTree(blocks: Block[][], centerX: number, surfaceY: number) {
    // Generate taller special tree blocks (4585) with proper placement
    const treeHeight = 1;
    
    for (let h = 0; h < treeHeight; h++) {
      const treeY = surfaceY - 1 - h;
      if (treeY >= 0 && treeY < this.height && 
          blocks[treeY] && blocks[treeY][centerX] && 
          blocks[treeY][centerX].fg === 0) {
        
        blocks[treeY][centerX].fg = 4585; // Tree block
      }
    }
    
    // Add grass around base occasionally
    for (let dx = -1; dx <= 1; dx++) {
      const grassX = centerX + dx;
      if (grassX >= 0 && grassX < this.width && dx !== 0) {
        if (blocks[surfaceY - 1] && blocks[surfaceY - 1][grassX] && 
            blocks[surfaceY - 1][grassX].fg === 0 && this.treeRandom() > 0.6 && (blocks[surfaceY][grassX].fg === 2 || blocks[surfaceY][grassX].fg === 442) && // Dirt or sand below
            blocks[surfaceY - 1][grassX].fg === 0) {
          blocks[surfaceY - 1][grassX].fg = 16; // Grass
        }
      }
    }
  }

  private generateOakTree(blocks: Block[][], centerX: number, surfaceY: number) {
    const trunkHeight = Math.floor(this.treeRandom() * 4) + 5; // Increased from 4-6 to 5-8 blocks tall
    
    // Generate trunk
    for (let y = surfaceY - 1; y > surfaceY - trunkHeight - 1 && y >= 0; y--) {
      if (blocks[y] && blocks[y][centerX] && blocks[y][centerX].fg === 0) {
        blocks[y][centerX].fg = 1102; // Log
      }
    }
    
    // Generate crown with more realistic, organic shape
    const crownCenter = surfaceY - trunkHeight;
    const crownRadius = 3; // Increased from 2 to 3
    
    // Store leaf positions for later root generation
    const leafPositions: {x: number, y: number}[] = [];
    
    // Create multiple leaf layers with different densities for natural look
    for (let dy = -crownRadius; dy <= crownRadius + 1; dy++) {
      for (let dx = -crownRadius; dx <= crownRadius; dx++) {
        const leafY = crownCenter + dy;
        const leafX = centerX + dx;
        
        if (leafY >= 0 && leafY < this.height && leafX >= 0 && leafX < this.width) {
          if (blocks[leafY] && blocks[leafY][leafX] && blocks[leafY][leafX].fg === 0) {
            const euclideanDistance = Math.sqrt(dx * dx + dy * dy);
            const manhattanDistance = Math.abs(dx) + Math.abs(dy);
            
            // Multi-layered probability system for natural clustering
            let leafChance = 0;
            
            // Core dense area (center of crown)
            if (euclideanDistance <= 1.5) {
              leafChance = 0.95; // Very dense center
            }
            // Middle layer with natural variation
            else if (euclideanDistance <= 2.5) {
              leafChance = 0.8 - (euclideanDistance - 1.5) * 0.3; // Gradual falloff
            }
            // Outer sparse layer for natural edges
            else if (euclideanDistance <= 3.5) {
              leafChance = 0.4 - (euclideanDistance - 2.5) * 0.2; // Sparse edges
            }
            
            // Add organic randomness based on position
            const positionNoise = Math.sin(leafX * 0.5) * Math.cos(leafY * 0.3) * 0.1;
            leafChance += positionNoise;
            
            // Create natural gaps and clusters
            const clusterNoise = (this.treeRandom() - 0.5) * 0.3;
            leafChance += clusterNoise;
            
            // Asymmetry for more natural look
            if (dx > 0) leafChance *= 0.9; // Slightly less dense on right side
            if (dy < 0) leafChance *= 1.1; // Slightly more dense on top
            
            // Edge thinning - make edges more irregular
            if (manhattanDistance >= crownRadius) {
              leafChance *= 0.6;
            }
            
            // Final placement decision
            if (this.treeRandom() < leafChance) {
              blocks[leafY][leafX].fg = 1104; // Leaf
              leafPositions.push({x: leafX, y: leafY}); // Store for root generation
            }
          }
        }
      }
    }
    
    // Generate hanging roots (id: 8934) below leaves
    this.generateHangingRoots(blocks, leafPositions);
  }

  private generatePineTree(blocks: Block[][], centerX: number, surfaceY: number) {
    const trunkHeight = Math.floor(this.treeRandom() * 5) + 6; // Increased from 5-8 to 6-10 blocks tall
    
    // Generate trunk
    for (let y = surfaceY - 1; y > surfaceY - trunkHeight - 1 && y >= 0; y--) {
      if (blocks[y] && blocks[y][centerX] && blocks[y][centerX].fg === 0) {
        blocks[y][centerX].fg = 1102; // Log
      }
    }
    
    // Generate realistic conical crown with layered approach
    const crownCenter = surfaceY - trunkHeight;
    const maxRadius = 3;
    
    // Store leaf positions for later root generation
    const leafPositions: {x: number, y: number}[] = [];
    
    for (let dy = -maxRadius; dy <= maxRadius + 1; dy++) {
      for (let dx = -maxRadius; dx <= maxRadius; dx++) {
        const leafY = crownCenter + dy;
        const leafX = centerX + dx;
        
        if (leafY >= 0 && leafY < this.height && leafX >= 0 && leafX < this.width) {
          if (blocks[leafY] && blocks[leafY][leafX] && blocks[leafY][leafX].fg === 0) {
            const euclideanDistance = Math.sqrt(dx * dx + dy * dy);
            
            // Conical shape - radius decreases as we go up
            const heightRatio = (dy + maxRadius) / (maxRadius * 2); // 0 at top, 1 at bottom
            const allowedRadius = 0.8 + heightRatio * 2.2; // Narrow at top, wider at bottom
            
            let leafChance = 0;
            
            if (euclideanDistance <= allowedRadius) {
              // Dense core for pine needle clusters
              if (euclideanDistance <= allowedRadius * 0.5) {
                leafChance = 0.9; // Very dense inner needles
              }
              // Medium density middle layer
              else if (euclideanDistance <= allowedRadius * 0.8) {
                leafChance = 0.75; // Medium density
              }
              // Sparse outer needles
              else {
                leafChance = 0.5; // Sparse outer layer
              }
              
              // Add vertical clustering typical of pine needles
              const verticalCluster = Math.sin(leafY * 0.8) * 0.15;
              leafChance += verticalCluster;
              
              // Horizontal needle pattern
              const horizontalPattern = Math.cos(leafX * 0.6) * 0.1;
              leafChance += horizontalPattern;
              
              // Random variation for natural look
              const randomNoise = (this.treeRandom() - 0.5) * 0.2;
              leafChance += randomNoise;
              
              // Pine trees are denser toward the trunk and bottom
              if (Math.abs(dx) <= 1) leafChance *= 1.2; // Denser near trunk
              if (dy > 0) leafChance *= 1.1; // Denser toward bottom
              
              // Create natural drooping effect
              if (dy > 0 && Math.abs(dx) > 1) {
                leafChance *= 0.8; // Less dense at outer bottom edges
              }
            }
            
            // Final placement decision
            if (this.treeRandom() < leafChance && euclideanDistance <= allowedRadius) {
              blocks[leafY][leafX].fg = 1104; // Leaf (pine needles)
              leafPositions.push({x: leafX, y: leafY}); // Store for root generation
            }
          }
        }
      }
    }
    
    // Generate hanging roots for pine trees too
    this.generateHangingRoots(blocks, leafPositions);
  }

  private generateHangingRoots(blocks: Block[][], leafPositions: {x: number, y: number}[]) {
    // Generate hanging roots (akar beringin) below leaf blocks
    for (const leaf of leafPositions) {
      // Only generate roots from some leaves (not all)
      if (this.treeRandom() > 0.5) {
        const rootLength = Math.floor(this.treeRandom() * 3) + 1; // 1-3 blocks long
        
        // Generate roots hanging downward
        for (let r = 1; r <= rootLength; r++) {
          const rootY = leaf.y + r; // Below the leaf
          const rootX = leaf.x;
          
          // Stop if we hit the ground or another block
          if (rootY >= this.height || rootY < 0) break;
          if (blocks[rootY] && blocks[rootY][rootX]) {
            let isAir = true;
            for (let dy = rootY; dy < rootY + rootLength; dy++) {
              if (blocks[dy] && blocks[dy][rootX] && blocks[dy][rootX].fg!== 0) {
                isAir = false;
              }
            }

            if (!isAir) break;
            
            blocks[rootY][rootX].fg = 8934; // Hanging root block
            
            // Chance for root to stop early for natural variation
            if (this.treeRandom() > 0.6) break;
          }
        }
      }
    }
  }

  private generateGrass(blocks: Block[][], terrainHeights: number[]) {
    // Generate grass only on proper surface blocks using grass-specific random
    for (let x = 0; x < this.width; x++) {
      const surfaceY = terrainHeights[x];
      
      if (surfaceY - 1 >= 0 && blocks[surfaceY - 1] && blocks[surfaceY - 1][x]) {
        // Only place grass on dirt or sand surface with air above
        if (blocks[surfaceY] && blocks[surfaceY][x] && 
            (blocks[surfaceY][x].fg === 2 || blocks[surfaceY][x].fg === 442) && // Dirt or sand below
            blocks[surfaceY - 1][x].fg === 0) { // Air above
          
          // Create natural grass distribution
          if (this.grassRandom() > 0.25) { // 75% chance for grass
            blocks[surfaceY - 1][x].fg = 16; // Grass
          }
        }
      }
    }
  }

  private generateHills(blocks: Block[][], biomeStart: number, biomeEnd: number, terrainHeights: number[]) {
    for (let x = biomeStart; x < biomeEnd; x++) {
      // Make hills a bit rockier
      if (this.generalRandom() > 0.5) {
        for (let y = terrainHeights[x]; y < terrainHeights[x] + 7 && y < this.height; y++) {
          if (blocks[y] && blocks[y][x]) {
            blocks[y][x].fg = this.generalRandom() > 0.3 ? 10 : 2;  // Rock or Dirt
          }
        }
      }
    }
  }
    
  private generateHouse(blocks: Block[][], x: number, y: number) {
    // Basic house structure (you can expand this)
    if (blocks[y + 1] && blocks[y + 1][x - 2]) blocks[y + 1][x - 2].fg = 52;  // Wooden Background
    if (blocks[y + 1] && blocks[y + 1][x - 1]) blocks[y + 1][x - 1].fg = 52;
    if (blocks[y + 1] && blocks[y + 1][x])     blocks[y + 1][x].fg     = 52;
    if (blocks[y + 1] && blocks[y + 1][x + 1]) blocks[y + 1][x + 1].fg = 52;
    if (blocks[y + 1] && blocks[y + 1][x + 2]) blocks[y + 1][x + 2].fg = 52;
   
    if (blocks[y + 2] && blocks[y + 2][x - 2]) blocks[y + 2][x - 2].fg = 52;
    if (blocks[y + 2] && blocks[y + 2][x - 1]) blocks[y + 2][x - 1].fg = 54;  // Window
    if (blocks[y + 2] && blocks[y + 2][x])     blocks[y + 2][x].fg     = 52;
    if (blocks[y + 2] && blocks[y + 2][x + 1]) blocks[y + 2][x + 1].fg = 54;  // Window
    if (blocks[y + 2] && blocks[y + 2][x + 2]) blocks[y + 2][x + 2].fg = 52;
   
    if (blocks[y + 3] && blocks[y + 3][x - 2]) blocks[y + 3][x - 2].fg = 52;
    if (blocks[y + 3] && blocks[y + 3][x - 1]) blocks[y + 3][x - 1].fg = 52;
    if (blocks[y + 3] && blocks[y + 3][x])     blocks[y + 3][x].fg     = 52;
    if (blocks[y + 3] && blocks[y + 3][x + 1]) blocks[y + 3][x + 1].fg = 52;
    if (blocks[y + 3] && blocks[y + 3][x + 2]) blocks[y + 3][x + 2].fg = 52;
   
    if (blocks[y + 4] && blocks[y + 4][x - 2]) blocks[y + 4][x - 2].fg = 116; // Bricks (Roof)
    if (blocks[y + 4] && blocks[y + 4][x - 1]) blocks[y + 4][x - 1].fg = 116;
    if (blocks[y + 4] && blocks[y + 4][x])     blocks[y + 4][x].fg     = 116;
    if (blocks[y + 4] && blocks[y + 4][x + 1]) blocks[y + 4][x + 1].fg = 116;
    if (blocks[y + 4] && blocks[y + 4][x + 2]) blocks[y + 4][x + 2].fg = 116;
   
    if (blocks[y + 1] && blocks[y + 1][x])     blocks[y + 1][x].fg     = 6;  // Main Door
  } 
  
  private generateCastle(blocks: Block[][], x: number, y: number) {
    // Simple castle tower (you can expand this)
    for (let i = -2; i <= 2; i++) {
      for (let j = 0; j <= 4; j++) {
        if (blocks[y + j] && blocks[y + j][x + i]) blocks[y + j][x + i].fg = 116;  // Bricks
      }
      if (blocks[y + 5] && blocks[y + 5][x + i]) blocks[y + 5][x + i].fg = 10;   // Rock (Tower top)
    }
    if (blocks[y + 1] && blocks[y + 1][x])     blocks[y + 1][x].fg     = 30;  // Dungeon Door
  }

  private generatePlains(blocks: Block[][], biomeStart: number, biomeEnd: number, terrainHeights: number[]) {
    const randomBlock = [1104, 826, 13202, 1004, 7374];

    for (let x = biomeStart; x < biomeEnd; x++) {
      for (let y = terrainHeights[x]; y < terrainHeights[x] + 5 && y < this.height; y++) {
        if (blocks[y] && blocks[y][x]) {
          blocks[y][x].fg = this.generalRandom() > 0.2 ? 2 : randomBlock[randomInt(0, randomBlock.length)];  // Dirt or random block
        }
      }
    }
  }

  public generate(): Promise<void> {
    return new Promise((res, _rej) => {
      // Create 2D array for easier manipulation
      const blocks: Block[][] = [];
      for (let y = 0; y < this.height; y++) {
        blocks[y] = [];
        for (let x = 0; x < this.width; x++) {
          blocks[y][x] = { x, y, fg: 0, bg: 0 };
        }
      }

      
      // Main door position (fixed position for consistency)
      let terrainHeights: number[] = [];
      const mainDoorPosition = Math.floor(this.width * 0.25); // 25% from left
      terrainHeights[mainDoorPosition] = Y_START_DIRT; // Ensure flat area for door
      
      // Smooth area around door
      for (let i = -5; i <= 5; i++) {
        const pos = mainDoorPosition + i;
        if (pos >= 0 && pos < this.width) {
          terrainHeights[pos] = Y_START_DIRT;
        }
      }

      // Generate improved terrain
      terrainHeights = this.generateImprovedTerrain();

      // Biome distribution
      const biomeWidth = 50;
      for (let i = 0; i < this.width; i += biomeWidth) {
        const biomeType = Math.floor(this.generalRandom() * 3);  // 0: Forest, 1: Plains, 2: Hills
        const biomeStart = i;
        const biomeEnd = Math.min(i + biomeWidth, this.width);

        for (let x = biomeStart; x < biomeEnd; x++) {
          for (let y = 0; y < this.height; y++) {
            const block = blocks[y][x];
            const surfaceLevel = terrainHeights[x];

            // EXIT door placement (fixed the white door issue)
            if (block.y === surfaceLevel - 1 && block.x === mainDoorPosition) {
              block.fg = 6; // Proper door block
              block.door = {
                label:       "EXIT",
                destination: "EXIT"
              };
            } 
            // Underground generation
            else if (block.y >= surfaceLevel) {
              if (block.x === mainDoorPosition && block.y === surfaceLevel) {
                block.fg = 8; // Bedrock under door
              } else if (block.y < Y_END_DIRT) {
                if (block.y >= Y_LAVA_START) {
                  // Deep underground with proper distribution
                  const rand = this.generalRandom();
                  if (rand > 0.8) {
                    block.fg = 4; // Lava (20% chance)
                  } else if (rand > 0.3) {
                    block.fg = 2; // Dirt (50% chance)
                  } else {
                    block.fg = 10; // Rock (30% chance)
                  }
                } else {
                  // Surface dirt layer
                  block.fg = this.generalRandom() > 0.05 ? 2 : 10; // Mostly dirt, some rock
                }
              } else {
                block.fg = 8; // Bedrock at bottom
              }
              block.bg = 14; // Cave background for underground
            }
          }
        }

        // Biome-specific generation
        if (biomeType === 1) { // Plains
          this.generatePlains(blocks, biomeStart, biomeEnd, terrainHeights);
          if (this.generalRandom() > 0.8) {  // 20% chance for a house in plains
            const houseX = biomeStart + Math.floor(this.generalRandom() * (biomeEnd - biomeStart - 5)) + 2;
            const houseY = terrainHeights[houseX] - 1;
            this.generateHouse(blocks, houseX, houseY);
          }
        } else if (biomeType === 2) { // Hills
          this.generateHills(blocks, biomeStart, biomeEnd, terrainHeights);
          if (this.generalRandom() > 0.7) {  // 30% chance for a castle in hills
            const castleX = biomeStart + Math.floor(this.generalRandom() * (biomeEnd - biomeStart - 5)) + 2;
            const castleY = terrainHeights[castleX] - 1;
            this.generateCastle(blocks, castleX, castleY);
          }
        }
      }

      // Generate forest features in correct order
      this.generateWaterBodies(blocks, terrainHeights, mainDoorPosition);
      this.generateTrees(blocks, terrainHeights, mainDoorPosition);
      this.generateGrass(blocks, terrainHeights);

      // Convert back to 1D array
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          this.data.blocks.push(blocks[y][x]);
        }
      }

      res();
    });
  }
}