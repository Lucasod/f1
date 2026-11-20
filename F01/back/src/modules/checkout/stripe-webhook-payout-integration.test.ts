import { afterEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { Request, Response } from 'express';
import {
  createStripeWebhookHandler,
} from './stripe-webhook.handler';

describe('Stripe webhook handler — Payment → Transfer → Payout integration (R-06)', () => {
  afterEach(() => vi.unstubAllEnvs());

  function makeTransferPaidEvent(stripeTransferId: string): Stripe.Event {
    return {
      id: `evt_transfer_paid_${stripeTransferId}`,
      type: 'transfer.paid',
      data: { object: { id: stripeTransferId, amount: 5000, currency: 'brl', status: 'paid' } },
    } as unknown as Stripe.Event;
  }

  function makeTransferReversedEvent(stripeTransferId: string): Stripe.Event {
    return {
      id: `evt_transfer_reversed_${stripeTransferId}`,
      type: 'transfer.reversed',
      data: { object: { id: stripeTransferId, amount: 5000, currency: 'brl', status: 'reversed' } },
    } as unknown as Stripe.Event;
  }

  function buildHandler(overrides: {
    completeTransfer?: any;
    failTransfer?: any;
    reverseTransfer?: any;
    findByStripeTransferId?: any;
    createPayoutFromTransfer?: any;
    findPayoutsByReference?: any;
    cancelPayout?: any;
  } = {}) {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');

    const completeTransfer = overrides.completeTransfer ?? vi.fn().mockResolvedValue({
      id: 'trs_ord1_ovg1',
      orderId: 'order-1',
      orderVendorGroupId: 'ovg-1',
      amount: 5000,
      currency: 'brl',
      stripeTransferId: 'trs_test_transfer_id',
      status: 'completed',
    } as any);
    const failTransfer = overrides.failTransfer ?? vi.fn().mockResolvedValue(null);
    const reverseTransfer = overrides.reverseTransfer ?? vi.fn().mockResolvedValue(null);
    const findByStripeTransferId = overrides.findByStripeTransferId ?? vi.fn().mockResolvedValue({
      id: 'trs_ord1_ovg1',
      orderId: 'order-1',
      orderVendorGroupId: 'ovg-1',
      amount: 5000,
      currency: 'brl',
      stripeTransferId: 'trs_test_transfer_id',
      status: 'completed',
    } as any);
    const createPayoutFromTransfer = overrides.createPayoutFromTransfer ?? vi.fn().mockResolvedValue({
      id: 'payout-1',
      vendorId: 'vendor-1',
      personId: 'person-1',
      amount: 5000,
      reference: 'trs_ord1_ovg1',
      status: 'pending',
    } as any);
    const findPayoutsByReference = overrides.findPayoutsByReference ?? vi.fn().mockResolvedValue([]);
    const cancelPayout = overrides.cancelPayout ?? vi.fn().mockResolvedValue({ id: 'payout-1', status: 'cancelled' } as any);

    const constructEvent = vi.fn();
    const handler = createStripeWebhookHandler(
      { webhooks: { constructEvent } } as never,
      {} as any,
      {} as any,
      { completeTransfer, failTransfer, reverseTransfer, findByStripeTransferId } as any,
      { createPayoutFromTransfer, findPayoutsByReference, cancelPayout } as any
    );
    return { handler, constructEvent, completeTransfer, failTransfer, reverseTransfer, findByStripeTransferId, createPayoutFromTransfer, findPayoutsByReference, cancelPayout };
  }

  function makeReqResp(event: Stripe.Event) {
    const constructEvent = vi.fn().mockReturnValue(event);
    const handler = createStripeWebhookHandler(
      { webhooks: { constructEvent } } as never,
      {} as any,
      {} as any,
      {
        completeTransfer: vi.fn().mockResolvedValue({
          id: 'trs_ord1_ovg1', orderId: 'order-1', orderVendorGroupId: 'ovg-1', amount: 5000, currency: 'brl',
          stripeTransferId: 'trs_test_transfer_id', status: 'completed',
        } as any),
        failTransfer: vi.fn().mockResolvedValue(null),
        reverseTransfer: vi.fn().mockResolvedValue(null),
        findByStripeTransferId: vi.fn().mockResolvedValue({
          id: 'trs_ord1_ovg1', orderId: 'order-1', orderVendorGroupId: 'ovg-1', amount: 5000, currency: 'brl',
          stripeTransferId: 'trs_test_transfer_id', status: 'completed',
        } as any),
      } as any,
      {
        createPayoutFromTransfer: vi.fn().mockResolvedValue({
          id: 'payout-1', vendorId: 'vendor-1', personId: 'person-1', amount: 5000, reference: 'trs_ord1_ovg1', status: 'pending',
        } as any),
        findPayoutsByReference: vi.fn().mockResolvedValue([]),
        cancelPayout: vi.fn().mockResolvedValue({ id: 'payout-1', status: 'cancelled' } as any),
      } as any
    );
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
    return { handler, constructEvent, req, res };
  }

  describe('transfer.paid → Payout automático vinculado', () => {
    it('cria Payout vinculado à transferência quando transfer.paid é recebido', async () => {
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
      const event = makeTransferPaidEvent('trs_test_transfer_id');
      const { handler, constructEvent, createPayoutFromTransfer, completeTransfer, findByStripeTransferId } = buildHandler();
      constructEvent.mockReturnValue(event);
      const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

      await handler(req, res, vi.fn());

      expect(constructEvent).toHaveBeenCalledWith(req.body, 'sig_test', 'whsec_test');
      expect(findByStripeTransferId).toHaveBeenCalledWith('trs_test_transfer_id');
      expect(completeTransfer).toHaveBeenCalledWith('trs_test_transfer_id');
      // Payout criado com referência ao transfer id (entity.id)
      expect(createPayoutFromTransfer).toHaveBeenCalledWith(
        'trs_ord1_ovg1', 5000, 'order-1', 'ovg-1'
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });

    it('popula payout.reference com o identificador da transferência', async () => {
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
      const event = makeTransferPaidEvent('trs_test_transfer_id_2');
      const { handler, constructEvent, createPayoutFromTransfer } = buildHandler({
        findByStripeTransferId: vi.fn().mockResolvedValue({
          id: 'trs_ord2_ovg2', orderId: 'order-2', orderVendorGroupId: 'ovg-2', amount: 7500, currency: 'brl',
          stripeTransferId: 'trs_test_transfer_id_2', status: 'completed',
        } as any),
      });
      constructEvent.mockReturnValue(event);
      const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

      await handler(req, res, vi.fn());

      expect(createPayoutFromTransfer).toHaveBeenCalledWith(
        'trs_ord2_ovg2', 7500, 'order-2', 'ovg-2'
      );
    });

    it('retorna 200 quando transferência não encontrada (transfer.paid sem entidade)', async () => {
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
      const event = makeTransferPaidEvent('trs_unknown');
      const { handler, constructEvent } = buildHandler({
        findByStripeTransferId: vi.fn().mockResolvedValue(null),
        createPayoutFromTransfer: vi.fn(),
      });
      constructEvent.mockReturnValue(event);
      const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });
  });

  describe('transfer.paid → idempotência (reentrega não duplica payout)', () => {
    it('não cria payout duplicado quando createPayoutFromTransfer retorna o existente', async () => {
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
      const event = makeTransferPaidEvent('trs_test_transfer_id');
      const createPayoutFromTransfer = vi.fn().mockResolvedValue({
        id: 'payout-1', vendorId: 'vendor-1', personId: 'person-1', amount: 5000, reference: 'trs_ord1_ovg1', status: 'pending',
      } as any);
      const { handler, constructEvent } = buildHandler({ createPayoutFromTransfer });
      constructEvent.mockReturnValue(event);
      const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
      const res1 = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
      const res2 = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

      await handler(req, res1, vi.fn());
      await handler(req, res2, vi.fn());

      // completeTransfer é idempotente (mock retornando a mesma entidade)
      // createPayoutFromTransfer chamado em cada entrega, mas retorna o mesmo payout existente
      expect(createPayoutFromTransfer).toHaveBeenCalledTimes(2);
      expect(res1.status).toHaveBeenCalledWith(200);
      expect(res2.status).toHaveBeenCalledWith(200);
    });
  });

  describe('transfer.reversed → cancelamento de payout vinculado', () => {
    it('cancela payouts vinculados quando transfer.reversed é recebido', async () => {
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
      const event = makeTransferReversedEvent('trs_test_transfer_id');
      const findPayoutsByReference = vi.fn().mockResolvedValue([
        { id: 'payout-1', status: 'pending', reference: 'trs_ord1_ovg1' } as any,
        { id: 'payout-2', status: 'approved', reference: 'trs_ord1_ovg1' } as any,
      ]);
      const cancelPayout = vi.fn().mockResolvedValue({ id: 'payout-1', status: 'cancelled' } as any);
      const { handler, constructEvent } = buildHandler({ findPayoutsByReference, cancelPayout });
      constructEvent.mockReturnValue(event);
      const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

      await handler(req, res, vi.fn());

      expect(cancelPayout).toHaveBeenCalledWith('payout-1', 'system', true);
      expect(cancelPayout).toHaveBeenCalledWith('payout-2', 'system', true);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('não tenta cancelar payouts já em status terminal', async () => {
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
      const event = makeTransferReversedEvent('trs_test_transfer_id');
      const findPayoutsByReference = vi.fn().mockResolvedValue([
        { id: 'payout-1', status: 'completed', reference: 'trs_ord1_ovg1' } as any,
      ]);
      const cancelPayout = vi.fn();
      const { handler, constructEvent } = buildHandler({ findPayoutsByReference, cancelPayout });
      constructEvent.mockReturnValue(event);
      const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

      await handler(req, res, vi.fn());

      expect(cancelPayout).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('transfer.paid → falha intermediária detectável e recuperável', () => {
    it('retorna 500 quando createPayoutFromTransfer falha', async () => {
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
      const event = makeTransferPaidEvent('trs_test_transfer_id');
      const createPayoutFromTransfer = vi.fn().mockRejectedValue(new Error('MONGO_WRITE_CONCERN_FAILURE'));
      const { handler, constructEvent } = buildHandler({ createPayoutFromTransfer });
      constructEvent.mockReturnValue(event);
      const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'PAYOUT_CREATION_FAILED' });
    });

    it('reentrega após falha de payout não duplica (idempotência via reference)', async () => {
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
      const event = makeTransferPaidEvent('trs_test_transfer_id');

      // Primeira entrega: createPayoutFromTransfer falha
      const firstCreate = vi.fn().mockRejectedValue(new Error('MONGO_WRITE_CONCERN_FAILURE'));
      // Segunda entrega (reentrega): createPayoutFromTransfer retorna o payout existente
      const secondCreate = vi.fn().mockResolvedValue({
        id: 'payout-1', vendorId: 'vendor-1', personId: 'person-1', amount: 5000, reference: 'trs_ord1_ovg1', status: 'pending',
      } as any);

      // Primeiro handler: falha na criação de payout
      const { handler: handler1, constructEvent: constructEvent1 } = buildHandler({ createPayoutFromTransfer: firstCreate });
      constructEvent1.mockReturnValue(event);
      const req1 = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
      const res1 = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

      await handler1(req1, res1, vi.fn());
      expect(res1.status).toHaveBeenCalledWith(500);

      // Segundo handler (reentrega): payout já existe, retornado sem duplicar
      const { handler: handler2, constructEvent: constructEvent2 } = buildHandler({ createPayoutFromTransfer: secondCreate });
      constructEvent2.mockReturnValue(event);
      const req2 = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
      const res2 = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

      await handler2(req2, res2, vi.fn());
      expect(res2.status).toHaveBeenCalledWith(200);
      expect(secondCreate).toHaveBeenCalledTimes(1);
    });
  });
});
