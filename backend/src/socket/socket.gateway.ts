import { Session, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from 'src/auth/auth.service';
import { playerMovementDataDto } from './dto/player.dto';
import { WsExceptionFilter } from './filter/ws.filter';
import { movementValidationPipe } from './pipes/movement.pipe';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { signupDataDto } from 'src/auth/dto/user-data.dto';
import { Cron } from '@nestjs/schedule';

const initPositionByRoomName = {
  town: {
    x: 800,
    y: 800,
  },
  maze: {
    x: 1000,
    y: 1500,
  },
  running: {
    x: 1750,
    y: 1900,
  },
  survival: {
    x: 1000,
    y: 1500,
  },
};

@UseFilters(WsExceptionFilter)
@WebSocketGateway({
  pingInterval: 5000,
  pingTimeout: 3000,
})
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  socketIdByUser = new Map();
  walkCountByUser = new Map();
  offerMap = new Map();

  constructor(
    private readonly authService: AuthService,
    private event: EventEmitter2
  ) {}

  /** room 안의 유저들을 불러옵니다. */
  public getRoomUserData(roomName: string) {
    const roomUser = [];
    if (!this.server.sockets.adapter.rooms.has(roomName)) return [];
    this.server.sockets.adapter.rooms.get(roomName).forEach(e => {
      roomUser.push(this.server.sockets.sockets.get(e)['userData']);
    });

    return roomUser;
  }

  public handleConnection(client: Socket): void {
    const key = client.handshake?.headers?.authorization;
    const roomName = client.handshake?.headers?.room;
    const userData = this.authService.verify(key);
    if (!userData || !roomName) {
      client.disconnect();
      return;
    }

    if (this.socketIdByUser.get(userData['id'])) {
      this.server.sockets.sockets
        .get(this.socketIdByUser.get(userData['id']))
        .disconnect();
    }

    client['userData'] = {
      ...userData,
      x: 800,
      y: 800,
      direction: 'right',
      state: 'wait',
      userState: 'on',
      walk: this.walkCountByUser.get(userData['id']) || 0,
      roomName,
      callingRoom: '',
    };

    this.socketIdByUser.set(userData['id'], client.id);
    client.join(roomName);
    client.to(roomName).emit('userCreated', client['userData']);
    this.server
      .to(client.id)
      .emit('userInitiated', this.getRoomUserData(roomName + ''));
  }

  public handleDisconnect(client: Socket): void {
    this.server.emit('userLeaved', client['userData']);
    this.event.emit('walkSave', client['userData']);
    this.socketIdByUser.delete(client['userData']['id']);
  }

  @Cron('58 23 * * *', { name: 'walkSaveScheduler' })
  walkSaveScheduler() {
    this.event.emit('saveWalkCount', [...this.walkCountByUser]);
    this.walkCountByUser.clear();
  }

  @SubscribeMessage('userDataChanged')
  handleUserDataChanged(
    @ConnectedSocket() client: any,
    @MessageBody(ValidationPipe) payload: signupDataDto
  ) {
    client['userData'] = { ...client['userData'], ...payload };
    client
      .to(client['userData']['roomName'])
      .emit('userDataChanged', client['userData']);
  }

  @UsePipes(new ValidationPipe())
  @SubscribeMessage('move')
  handleMove(
    @ConnectedSocket() client: any,
    @MessageBody(movementValidationPipe)
    payload: playerMovementDataDto
  ) {
    this.walkCountByUser.set(
      client['userData']['id'],
      (this.walkCountByUser.get(client['userData']['id']) ?? 0) + 1
    );
    client['userData']['walk'] = Math.floor(
      this.walkCountByUser.get(client['userData']['id']) / 10
    );
    client['userData'] = { ...client['userData'], ...payload };
    this.server
      .to(client['userData']['roomName'])
      .emit('move', client['userData']);
  }

  @SubscribeMessage('publicChat')
  handleMessage(client: any, payload: any): void {
    const msgPayload = {
      fromUserId: client['userData']['id'],
      nickname: client['userData']['nickname'],
      timestamp: Date.now(),
      message: payload['message'] || '',
    };

    client.to(client['userData']['roomName']).emit('publicChat', msgPayload);
  }

  @SubscribeMessage('privateChat')
  handleDirectMessage(client: any, payload: any): void {
    const targetUserId = payload['targetUserId'];

    const msgPayload = {
      fromUserId: client['userData']['id'],
      nickname: client['userData']['nickname'],
      timestamp: Date.now(),
      message: payload['message'] || '',
    };
    this.event.emit('saveChat', { ...msgPayload, targetUserId });

    client
      .to(this.socketIdByUser.get(targetUserId))
      .emit('privateChat', msgPayload);
  }

  @SubscribeMessage('chatRoomEntered')
  handleChatRoomEntered(client: any, payload: any) {
    this.event.emit('createChatRoom', {
      fromUserId: client['userData']['id'],
      ...payload,
    });
  }

  @SubscribeMessage('chatRoomLeaved')
  handleChatRoomLeaved(client: any, payload: any) {
    this.event.emit('leaveChatRoom', {
      fromUserId: client['userData']['id'],
      ...payload,
    });
  }

  @SubscribeMessage('callRequested')
  handleCallRequested(client: any, payload: any) {
    //  프론트가 통화중인 상태였다면, 이미 갖고있는 uuid를 보내주고, 아니면 새로 생성해서 보내줌
    // uuid와 callee 필요!!
    const { calleeUserId, callingRoom } = payload;
    const callerUserId = client['userData']['id'];
    const callerSocket = client;
    const calleeSocket = this.server.sockets.sockets.get(
      this.socketIdByUser.get(calleeUserId)
    );
    callerSocket.join(callingRoom);
    calleeSocket.join(callingRoom);
    // on, off, busy, callRequesting

    // 두 사람의 상태 변경
    callerSocket['userData']['userState'] = 'busy';
    calleeSocket['userData']['userState'] = 'callRequesting';
    // 두사람의 전화중인 room 변경
    callerSocket['userData']['callingRoom'] = callingRoom;
    calleeSocket['userData']['callingRoom'] = callingRoom;

    // 나한테 통화 준비하라고 알려주는 거.
    this.server
      .to(this.socketIdByUser.get(callerUserId))
      .emit('remoteOffer', { offers: [] });

    // 받는 사람한테, 전화오고 있다고 알림
    callerSocket.to(calleeSocket.id).emit('callRequested', {
      callerUserId,
      callerNickname: callerSocket['userData']['nickname'],
    });

    // 모두에게 두 사람이 전화 중이라고 알리기
    this.server.to(client['userData']['roomName']).emit('userStateChanged', {
      userIdList: [calleeUserId, callerUserId],
      userState: 'busy',
    });
    // 해당 방에 callingRoom 변화 감지
    this.server.to(callingRoom).emit('callingRoomUserStateChanged', {
      callingRoomUserData: this.getRoomUserData(callingRoom),
    });
  }

  // 건 사람이 마음 바뀜 끊음. => 상대방만 on으로 변경
  @SubscribeMessage('callCanceled')
  handleCallCanceled(client: any, payload: any) {
    const { calleeUserId } = payload;
    const callerUserId = client['userData']['id'];
    const callerSocket = client;
    const calleeSocket = this.server.sockets.sockets.get(
      this.socketIdByUser.get(calleeUserId)
    );

    callerSocket.to(calleeSocket.id).emit('callCanceled', {
      callerUserId,
      callerNickname: callerSocket['userData']['nickname'],
    });
  }

  @SubscribeMessage('callLeaved')
  handleCallLeaved(client: any) {
    const leavingUserId = client['userData']['id'];
    const callingRoom = client['userData']['callingRoom'];

    client.leave(callingRoom);
    client['userData']['callingRoom'] = '';

    // 전 세계 사람들에게 알려주기
    this.server.to(client['userData']['roomName']).emit('userStateChanged', {
      userIdList: [leavingUserId],
      userState: 'on',
    });

    // 해당 방에 callingRoom 변화 감지
    this.server.to(callingRoom).emit('callingRoomUserStateChanged', {
      callingRoomUserData: this.getRoomUserData(callingRoom),
    });
  }

  @SubscribeMessage('callRejected')
  handleCallRejected(client: any, payload: any) {
    const { callerUserId } = payload;
    const calleeUserId = client['userData']['id'];
    const calleeSocket = client;
    const callerSocket = this.server.sockets.sockets.get(
      this.socketIdByUser.get(callerUserId)
    );

    calleeSocket.to(callerSocket.id).emit('callRejected', {
      calleeUserId,
      calleeNickname: calleeSocket['userData']['nickname'],
    });
  }

  // 전화 수락!!
  @SubscribeMessage('callEntered')
  handleCallEntered(client: any, payload: any) {
    const { callerUserId } = payload;
    const calleeUserId = client['userData']['id'];
    const calleeSocket = client;
    const callerSocket = this.server.sockets.sockets.get(
      this.socketIdByUser.get(callerUserId)
    );
    const callingRoom = client['userData']['callingRoom'];

    client['userData']['userState'] = 'busy';

    calleeSocket.to(callerSocket.id).emit('callEntered', {
      calleeUserId,
    });

    this.server.to(calleeSocket.id).emit('remoteOffer', {
      offers: [...this.offerMap.get(callingRoom)],
    });
    // this.server.to(this.socketIdByUser.get(calleeUserId)).emit('callCreated');

    // this.offerMap.get(callingRoom).set(callerUserId, callerOffer);
    // 회색 -> 진한 색
    this.server.to(callingRoom).emit('callingRoomUserStateChanged', {
      callingRoomUserData: this.getRoomUserData(callingRoom),
    });
  }

  @SubscribeMessage('disconnecting')
  handleDisconnecting(client: any) {
    client.disconnect();
  }

  @SubscribeMessage('newOffer')
  handleNewOffer(client: any, payload: any) {
    const callingRoom = client['userData']['callingRoom'];
    const offer = payload['offer'];
    if (!this.offerMap.get(callingRoom)) {
      this.offerMap.set(callingRoom, new Map());
      this.offerMap.get(callingRoom).set(client['userData']['id'], offer);
    }
  }
  @SubscribeMessage('newAnswer')
  handleNewAnswer(client: any, payload: any) {
    const { answer, userId } = payload;
    this.server
      .to(this.socketIdByUser.get(userId))
      .emit('remoteAnswer', { answer });
  }

  @SubscribeMessage('newIce')
  handleNewIce(client: any, payload: any) {
    const callingRoom = client['userData']['callingRoom'];

    const { iceCandidates } = payload;
    client.to(callingRoom).emit('remoteIce', { iceCandidates });
  }
  // 미니게임 친구들과 함께 하기 지정방!

  @SubscribeMessage('createNewGameRoom')
  handleCreateNewGameRoom(client: any, payload: any) {
    const { gameRoomId } = payload;
    // 방장이 방을 만들어서 타운에서 대기하고 있고! 이 방에 대기를 거는 사람들을 계속 뿌려줘야함!
    client.join(gameRoomId);
    // client.to(callingRoom).emit('remoteIce', { iceCandidates });
  }

  @SubscribeMessage('joinGameRoom')
  handleJoinGameRoom(client: any, payload: any) {
    const { gameRoomId } = payload;
    const gameRoom = this.server.sockets.adapter.rooms.get(gameRoomId);
    if (gameRoom && gameRoom.size < 4) {
      client.join(gameRoomId);
      this.server.to(gameRoomId).emit('gameRoomUserListChanged', {
        userList: this.getRoomUserData(gameRoomId),
      });
    } else {
      this.server.to(client.id).emit('gameAlert', {
        status: 'ROOM_NOT_EXIST',
        message: '해당하는 방이 없습니다.',
      });
    }
  }

  public roomChange(
    userSocketIdList,
    prevRoomName,
    nextRoomName,
    nextRoomType
  ) {
    // 캐릭터 중복문제 발생시 분명 여기임

    // socketId -> client[userData]
    userSocketIdList.forEach(userSocketId => {
      const user = this.server.sockets.sockets.get(userSocketId);

      user.join(nextRoomName);
      user.leave(prevRoomName);

      this.server.to(prevRoomName).emit('userLeaved', user['userData']);
      user['userData'] = {
        ...user['userData'],
        x: initPositionByRoomName[nextRoomType].x,
        y: initPositionByRoomName[nextRoomType].y,
        roomName: nextRoomName,
      };
      this.server.to(nextRoomName).emit('userCreated', user['userData']);
      this.server
        .to(userSocketId)
        .emit('userInitiated', this.getRoomUserData(nextRoomName + ''));
    });
  }

  @SubscribeMessage('startGame')
  handleStartGame(client: any, payload: any) {
    const { gameRoomId, gameType } = payload;

    // 이동시켜야하는 사람들을 그랩!
    const userSocketIdList = [
      ...this.server.sockets.adapter.rooms.get(gameRoomId).values(),
    ];

    this.roomChange(userSocketIdList, 'town', gameRoomId, gameType);
    // 게임 룸으로 이동이되도, 서로 보이거나 하려면 그안에 가서도 userIni creatd ????
    this.server.to(gameRoomId).emit('gameAlert', {
      status: 'GAME_START',
      message: '게임이 시작되었습니다',
    });
  }

  // 게임 중에 한명이! 나가는 거
  @SubscribeMessage('leaveGame')
  handleLeaveGame(client: any, payload: any) {
    const { gameRoomId } = payload;
    this.roomChange([client.id], gameRoomId, 'town', 'town');
  }

  // 게임 대기열에서 나감
  @SubscribeMessage('leaveGameWatingList')
  handleLeaveGameWatingList(client: any, payload: any) {
    const { gameRoomId } = payload;
    // uuid join! leave 대기열 gameAlert
    client.leave(gameRoomId);
    this.server.to(gameRoomId).emit('gameRoomUserListChanged', {
      userList: this.getRoomUserData(gameRoomId),
    });
  }
}
