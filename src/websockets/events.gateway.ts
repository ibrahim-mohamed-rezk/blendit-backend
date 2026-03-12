import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  namespace: '/',
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('EventsGateway');

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /** Join a room (pos, kitchen, delivery, customer-display) */
  @SubscribeMessage('join_room')
  handleJoinRoom(@MessageBody() room: string, @ConnectedSocket() client: Socket) {
    client.join(room);
    this.logger.log(`Client ${client.id} joined room: ${room}`);
    return { event: 'joined', data: room };
  }

  // ── Listeners on internal events (from OrdersService / DeliveryService) ──

  @OnEvent('order.created')
  handleOrderCreated(order: any) {
    this.server.to('pos').emit('new_order', order);
    this.server.to('kitchen').emit('new_order', order);
    // Customer display update
    this.server.to('customer-display').emit('customer_display_update', {
      order_number: order.order_number,
      customer_name: order.customer?.name || 'Walk-in Customer',
      items: order.items,
      total: order.total,
      status: order.status,
    });
  }

  @OnEvent('order.statusUpdated')
  handleOrderStatusUpdated(order: any) {
    this.server.emit('order_status_updated', {
      id: order.id,
      order_number: order.order_number,
      status: order.status,
    });
    this.server.to('customer-display').emit('customer_display_update', {
      order_number: order.order_number,
      customer_name: order.customer?.name || 'Walk-in Customer',
      items: order.items,
      total: order.total,
      status: order.status,
    });
  }

  @OnEvent('delivery.created')
  handleDeliveryCreated(delivery: any) {
    this.server.to('delivery').emit('delivery_order_created', delivery);
    this.server.to('pos').emit('delivery_order_created', delivery);
  }

  @OnEvent('delivery.statusUpdated')
  handleDeliveryStatusUpdated(delivery: any) {
    this.server.emit('delivery_order_updated', {
      id: delivery.id,
      status: delivery.status,
    });
  }
}
