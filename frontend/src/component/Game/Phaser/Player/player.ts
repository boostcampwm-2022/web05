import { sortHeldDirection, changePosition, changeState } from '../../util';

export class Player extends Phaser.GameObjects.Sprite {
  character: Phaser.GameObjects.Sprite | undefined;
  hair: Phaser.GameObjects.Sprite | undefined;
  dust: Phaser.GameObjects.Sprite | undefined;
  state: string = 'right';
  direction: string = 'wait';
  x: number;
  y: number;
  speed: number;
  heldDirection: string[];

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'character');
    this.direction = 'right';
    this.state = 'wait';
    this.x = -25;
    this.y = 400;
    this.speed = 1;
    this.heldDirection = [];

    this.character = this.scene.add.sprite(this.x, this.y, 'character-wait');
    this.character.setScale(3);

    this.hair = this.scene.add.sprite(this.x, this.y, 'hair-wait');
    this.hair.setScale(3);

    this.dust = this.scene.add.sprite(this.x - 20, this.y + 5, 'dust');
    this.dust.setScale(3);

    changeState(this);

    this.scene.cameras.main.startFollow(this.character, true);
  }

  update() {
    const cursors = this.scene.input.keyboard.createCursorKeys();
    const keyR = this.scene.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.R
    );
    const keyShift = this.scene.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SHIFT
    );

    const prevState = this.state;

    // motion
    if (keyR.isDown) {
      this.speed = 1.5;
      this.state = 'roll';
    } else if (keyShift.isDown) {
      this.speed = 1.2;
      this.state = 'run';
    } else {
      this.speed = 1;
      this.state = 'walk';
    }

    sortHeldDirection(this, cursors);
    if (this.heldDirection.length) changePosition(this, this.heldDirection);
    else this.state = 'wait';

    if (prevState !== this.state) changeState(this);
  }
}
