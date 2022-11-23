import { User } from 'src/auth/entity/user.entity';
import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

@Entity('following')
export class Following {
  @PrimaryColumn()
  userId: string;

  @PrimaryColumn()
  targetUserId: string;

  @ManyToOne(() => User, user => user.following, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => User, user => user.followedBy, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'targetUserId' })
  targetUser: User;
}
