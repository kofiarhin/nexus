import { ok, created } from '../utils/respond.js';
import { asyncHandler, requestContext } from './helpers.js';

export function createConversationController({ conversationService }) {
  return {
    list: asyncHandler(async (req, res) => {
      return ok(res, { conversations: conversationService.list() });
    }),

    create: asyncHandler(async (req, res) => {
      const conversation = conversationService.create({
        ...res.locals.body,
        actor: null
      });
      return created(res, { conversation });
    }),

    get: asyncHandler(async (req, res) => {
      return ok(res, { conversation: conversationService.get(req.params.conversationId) });
    }),

    remove: asyncHandler(async (req, res) => {
      conversationService.delete(req.params.conversationId);
      return ok(res, { deleted: true });
    }),

    /**
     * Sends a message. With `stream: true` the reply is delivered as Server-Sent
     * Events; the terminating event still carries the source manifest.
     */
    message: asyncHandler(async (req, res) => {
      const context = requestContext(res, req);
      const body = res.locals.body;

      if (!body.stream) {
        const result = await conversationService.sendMessage({
          conversationId: req.params.conversationId,
          content: body.content,
          allowOperations: body.allowOperations,
          actor: context.actor,
          requestId: context.requestId
        });
        return ok(res, result);
      }

      res.status(200).set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

      try {
        for await (const event of conversationService.streamMessage({
          conversationId: req.params.conversationId,
          content: body.content
        })) {
          send(event);
        }
      } catch (error) {
        send({
          type: 'error',
          code: error?.code ?? 'INTERNAL_ERROR',
          message: error?.expose ? error.message : 'The conversation could not be completed'
        });
      }

      send({ type: 'done' });
      return res.end();
    })
  };
}
