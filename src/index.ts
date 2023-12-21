import { defu } from "defu";
import * as diagnostics_channel from "node:diagnostics_channel";
import type { ClientRequest } from "node:http";
import * as inspector from "node:inspector";
import {
  DiagnosticChannelHttpRequestFinish,
  DiagnosticChannelHttpRequestStart,
  EmitMode,
  InitOptions,
  Logger,
  RequestTracker,
  timestamp,
} from "./RequestTracker";



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

  const inflightRequests = new Map<ClientRequest, RequestTracker>();

  const requestStartHandler = (event: DiagnosticChannelHttpRequestStart) => {
    const tracker = new RequestTracker(
      requestId++,
      event.request,
      inspectorSession,
      opts,
      initTime
    );
    logger.debug(
      `RequestTracker: Started request ${tracker.id} ${tracker.requestInfo.request.url}`
    );
    inflightRequests.set(tracker.request, tracker);
  };

  const undiciRequestStartHandler = (event: { request: Request }) => {
    console.log(event);
  }


  // http and https
  diagnostics_channel.subscribe("http.client.request.start", requestStartHandler as diagnostics_channel.ChannelListener);

  // fetch / undici
  diagnostics_channel.subscribe("undici:request:create", undiciRequestStartHandler as diagnostics_channel.ChannelListener);

  logger.log("Tracing started");
  return {
    stop: () => {
      diagnostics_channel.unsubscribe("http.client.request.start", requestStartHandler as diagnostics_channel.ChannelListener);
      diagnostics_channel.unsubscribe("undici:request:create", undiciRequestStartHandler as diagnostics_channel.ChannelListener);
      inspectorSession.disconnect();
      logger.log("Tracing stopped");
    },
  };
}
