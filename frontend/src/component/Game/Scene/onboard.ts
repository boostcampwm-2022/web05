import mazeJSON from '../../../assets/tilemaps/maze/maze.json';
import tileset3 from '../../../assets/tilemaps/maze/tileset3.png';
import townJSON from '../../../assets/tilemaps/town.json';
import town from '../../../assets/tilemaps/town.png';
import christmas from '../../../assets/audio/christmas.mp3';
import dust from '../../../assets/character/dust.png';
import spriteJSON from '../../../assets/character/sprite.json';

import waitImg from '../../../assets/character/wait/wait.png';
import walkImg from '../../../assets/character/walk/walk.png';
import runImg from '../../../assets/character/run/run.png';
import rollImg from '../../../assets/character/roll/roll.png';
import jumpImg from '../../../assets/character/jump/jump.png';
import attackImg from '../../../assets/character/attack/attack.png';
import swimmingImg from '../../../assets/character/swimming/swimming.png';
import { stringObjectType } from '../../../types/types';
import { actions } from '../util';

const characterImg: stringObjectType = {
  wait: waitImg,
  walk: walkImg,
  run: runImg,
  roll: rollImg,
  jump: jumpImg,
  attack: attackImg,
  swimming: swimmingImg,
};

export default class OnBoard extends Phaser.Scene {
  constructor() {
    super('OnBoard');
  }

  preload() {
    // 메인(town)
    this.load.tilemapTiledJSON('town', townJSON);
    this.load.image('tileset', town);

    // 미로(maze)
    this.load.tilemapTiledJSON('maze', mazeJSON);
    this.load.image('tileset3', tileset3);

    // 배경음악
    this.load.audio('christmas', [christmas]);

    // 캐릭터 동작
    actions.forEach((action: string) => {
      this.load.atlas(action, characterImg[action], spriteJSON);
    });

    // 이펙트
    this.load.spritesheet('dust', dust, {
      frameWidth: 24,
      frameHeight: 9,
    });
  }

  update() {
    // 메인(town)에서 시작
    this.scene.start('Town');
  }
}
