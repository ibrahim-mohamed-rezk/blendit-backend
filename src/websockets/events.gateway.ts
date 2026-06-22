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

  private branchRoom(role: string, branchId: number): string {
    return `${role}:${branchId}`;
  }

  private resolveBranchId(payload: { branch_id?: number; order?: { branch_id?: number } }): number | undefined {
    return payload.branch_id ?? payload.order?.branch_id;
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /** Join a room (pos:{branchId}, kitchen:{branchId}, delivery:{branchId}, customer-display:{branchId}, branch:{branchId}) */
  @SubscribeMessage('join_room')
  handleJoinRoom(@MessageBody() room: string, @ConnectedSocket() client: Socket) {
    client.join(room);
    this.logger.log(`Client ${client.id} joined room: ${room}`);
    return { event: 'joined', data: room };
  }

  /** Live cart update from POS - syncs to customer display for the active branch */
  @SubscribeMessage('cart_update')
  handleCartUpdate(
    @MessageBody()
    payload: {
      branch_id?: number;
      table?: string;
      items: Array<{
        productName: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        modificationsSummary?: string;
        notes?: string;
      }>;
      subtotal: number;
      tax: number;
      discount: number;
      total: number;
      customerName?: string;
      orderType?: string;
    },
    @ConnectedSocket() _client: Socket,
  ) {
    const branchId = payload.branch_id;
    const room =
      branchId != null ? this.branchRoom('customer-display', branchId) : 'customer-display';
    this.server.to(room).emit('live_cart', { ...payload, branch_id: branchId });
  }

  @OnEvent('order.created')
  handleOrderCreated(payload: { order: any; source: 'POS' | 'PUBLIC'; branch_id?: number }) {
    const { order, source } = payload;
    const branchId = this.resolveBranchId(payload) ?? order.branch_id;
    const posPayload = { ...order, order_source: source, branch_id: branchId };
    if (branchId != null) {
      this.server.to(this.branchRoom('pos', branchId)).emit('new_order', posPayload);
      this.server.to(this.branchRoom('kitchen', branchId)).emit('new_order', posPayload);
      this.server.to(this.branchRoom('customer-display', branchId)).emit('customer_display_update', {
        branch_id: branchId,
        order_number: order.order_number,
        customer_name: order.customer?.name || 'Walk-in Customer',
        items: order.items,
        total: order.total,
        status: order.status,
      });
      this.server.to(this.branchRoom('branch', branchId)).emit('order_book_changed', {
        branch_id: branchId,
        order_id: order.id,
        order_number: order.order_number,
        source,
      });
    }
  }

  @OnEvent('order.statusUpdated')
  handleOrderStatusUpdated(order: any) {
    const branchId = order.branch_id;
    const payload = {
      branch_id: branchId,
      id: order.id,
      order_number: order.order_number,
      status: order.status,
    };
    if (branchId != null) {
      this.server.to(this.branchRoom('branch', branchId)).emit('order_status_updated', payload);
      this.server.to(this.branchRoom('pos', branchId)).emit('order_status_updated', payload);
      this.server.to(this.branchRoom('kitchen', branchId)).emit('order_status_updated', payload);
      this.server.to(this.branchRoom('customer-display', branchId)).emit('customer_display_update', {
        branch_id: branchId,
        order_number: order.order_number,
        customer_name: order.customer?.name || 'Walk-in Customer',
        items: order.items,
        total: order.total,
        status: order.status,
      });
    }
  }

  @OnEvent('order.refunded')
  handleOrderRefunded(order: any) {
    this.handleOrderStatusUpdated(order);
  }

  @OnEvent('order.updated')
  handleOrderBodyUpdated(order: any) {
    const branchId = order.branch_id;
    const payload = {
      branch_id: branchId,
      id: order.id,
      order_number: order.order_number,
      status: order.status,
    };
    if (branchId != null) {
      this.server.to(this.branchRoom('branch', branchId)).emit('order_status_updated', payload);
      this.server.to(this.branchRoom('pos', branchId)).emit('order_status_updated', payload);
    }
  }

  @OnEvent('delivery.created')
  handleDeliveryCreated(delivery: any) {
    const branchId = delivery.branch_id;
    const payload = { ...delivery, branch_id: branchId };
    if (branchId != null) {
      this.server.to(this.branchRoom('delivery', branchId)).emit('delivery_order_created', payload);
      this.server.to(this.branchRoom('pos', branchId)).emit('delivery_order_created', payload);
    }
  }

  @OnEvent('delivery.statusUpdated')
  handleDeliveryStatusUpdated(delivery: any) {
    const branchId = delivery.branch_id;
    const payload = { branch_id: branchId, id: delivery.id, status: delivery.status };
    if (branchId != null) {
      this.server.to(this.branchRoom('branch', branchId)).emit('delivery_order_updated', payload);
      this.server.to(this.branchRoom('delivery', branchId)).emit('delivery_order_updated', payload);
      this.server.to(this.branchRoom('pos', branchId)).emit('delivery_order_updated', payload);
    }
  }

  @OnEvent('delivery.updated')
  handleDeliveryMetadataUpdated(delivery: any) {
    this.handleDeliveryStatusUpdated(delivery);
  }
}
