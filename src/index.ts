import { defu } from "defu";
import * as diagnostics_channel from "node:diagnostics_channel";
import * as inspector from "node:inspector";
import { NodeHttpRequest, UndiciHttpRequest } from "./Request";
import {
  DiagnosticChannelHttpRequestStart,
  EmitMode,
  InitOptions,
  RequestTracker,
  timestamp
} from "./RequestTracker";

export { EmitMode };

let requestId = 0;

interface TracingProcess {
  stop: () => void;
}

export const defaultOptions: InitOptions = {
  logger: console,
  emitModes: [EmitMode.LogSummary],
};

export function start(options?: InitOptions): TracingProcess {
  const opts = defu(options, defaultOptions);
  const logger = opts.logger!;
  const inspectorSession = new inspector.Session();
  inspectorSession.connect();
  const initTime = timestamp();

  const requestStartHandler = (event: DiagnosticChannelHttpRequestStart) => {
    const tracker = new RequestTracker(
      requestId++,
      new NodeHttpRequest(event.request),
      inspectorSession,
      opts,
      initTime
    );
    logger.debug(
      `RequestTracker: Started request ${tracker.id} ${tracker.requestInfo.request.url}`
    );
  };

  const undiciInflightRequests = new Map<Request, UndiciHttpRequest>();

  /**
   * from undici:request:create
   */
  const undiciRequestStartHandler = (event: { request: Request }) => {
    const undiciRequest = new UndiciHttpRequest(event.request);
    const tracker = new RequestTracker(
      requestId++,
      undiciRequest,
      inspectorSession,
      opts,
      initTime
    );
    undiciInflightRequests.set(event.request, undiciRequest);
  };

  /**
   * from undici:request:bodySent
   */
  const undiciRequestBodySentHandler = (event: { request: Request }) => {
    const undiciRequest = undiciInflightRequests.get(event.request);
    if (!undiciRequest) {
      logger.error(
        `RequestTracker: undici:request:bodySent: Could not find request for ${event.request}`
      );
      return;
    }
    undiciRequest.onBodySent();
  };

  /**
   * undici:request:headers
   * response headers have been received, i.e. the response has been completed.
   */
  const undiciRequestHeadersHandler = (event: { request: Request, response: Response }) => {
    const undiciRequest = undiciInflightRequests.get(event.request);
    if (!undiciRequest) {
      logger.error(
        `RequestTracker: undici:request:headers: Could not find request for ${event.request}`
      );
      return;
    }
    undiciRequest.onHeaders(event.response);
  };


  /**
   * from undici:client:sendHeaders
   * right before the first byte of the request is written to the socket.
   */
  const undiciSendHeadersHandler = (event: { request: Request }) => {
    const undiciRequest = undiciInflightRequests.get(event.request);
    if (!undiciRequest) {
      logger.error(
        `RequestTracker: undici:client:sendHeaders: Could not find request for ${event.request}`
      );
      return;
    }
    undiciRequest.onSendHeaders();
  };

  /**
   * from undici:request:trailers
   */
  const undiciRequestTrailersHandler = (event: { request: Request, response: Response }) => {
    const undiciRequest = undiciInflightRequests.get(event.request);
    if (!undiciRequest) {
      logger.error(
        `RequestTracker: undici:request:trailers: Could not find request for ${event.request}`
      );
      return;
    }
    undiciRequest.onTrailers(event.response);
  };

  /**
   * from undici:request:error
   */
  const undiciRequestErrorHandler = (event: { request: Request, error: Error }) => {
    const undiciRequest = undiciInflightRequests.get(event.request);
    if (!undiciRequest) {
      logger.error(
        `RequestTracker: undici:request:error: Could not find request for ${event.request}`
      );
      return;
    }
    undiciRequest.onError(event.error);
  };

  /**
   * from undici:client:connectError
   */
  const undiciConnectErrorHandler = (event: { request: Request, error: Error }) => {
    const undiciRequest = undiciInflightRequests.get(event.request);
    if (!undiciRequest) {
      logger.error(
        `RequestTracker: undici:client:connectError: Could not find request for ${event.request}`
      );
      return;
    }
    undiciRequest.onConnectError(event.error);
  };

  // http and https
  diagnostics_channel.subscribe("http.client.request.start", requestStartHandler as diagnostics_channel.ChannelListener);

  // fetch / undici
  diagnostics_channel.subscribe("undici:request:create", undiciRequestStartHandler as diagnostics_channel.ChannelListener);
  diagnostics_channel.subscribe("undici:request:bodySent", undiciRequestBodySentHandler as diagnostics_channel.ChannelListener);
  diagnostics_channel.subscribe("undici:request:headers", undiciRequestHeadersHandler as diagnostics_channel.ChannelListener);
  diagnostics_channel.subscribe("undici:client:sendHeaders", undiciSendHeadersHandler as diagnostics_channel.ChannelListener);
  diagnostics_channel.subscribe("undici:request:trailers", undiciRequestTrailersHandler as diagnostics_channel.ChannelListener);
  diagnostics_channel.subscribe("undici:request:error", undiciRequestErrorHandler as diagnostics_channel.ChannelListener);
  diagnostics_channel.subscribe("undici:client:connectError", undiciConnectErrorHandler as diagnostics_channel.ChannelListener);

  logger.log("Tracing started");
  return {
    stop: () => {
      diagnostics_channel.unsubscribe("http.client.request.start", requestStartHandler as diagnostics_channel.ChannelListener);
      diagnostics_channel.unsubscribe("undici:request:create", undiciRequestStartHandler as diagnostics_channel.ChannelListener);
      diagnostics_channel.unsubscribe("undici:request:bodySent", undiciRequestBodySentHandler as diagnostics_channel.ChannelListener);
      diagnostics_channel.unsubscribe("undici:request:headers", undiciRequestHeadersHandler as diagnostics_channel.ChannelListener);
      diagnostics_channel.unsubscribe("undici:client:sendHeaders", undiciSendHeadersHandler as diagnostics_channel.ChannelListener);
      diagnostics_channel.unsubscribe("undici:request:trailers", undiciRequestTrailersHandler as diagnostics_channel.ChannelListener);
      diagnostics_channel.unsubscribe("undici:request:error", undiciRequestErrorHandler as diagnostics_channel.ChannelListener);
      diagnostics_channel.unsubscribe("undici:client:connectError", undiciConnectErrorHandler as diagnostics_channel.ChannelListener);

      inspectorSession.disconnect();
      logger.log("Tracing stopped");
    },
  };
}
