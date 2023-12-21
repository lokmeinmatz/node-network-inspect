// inspired by https://github.com/node-inspector/node-inspector/blob/79e01c049286374f86dd560742a614019c02402f/lib/Injections/NetworkAgent.js#L252


import type {
  ClientRequest,
  IncomingMessage,
  OutgoingHttpHeaders,
} from "node:http";
import * as inspector from "node:inspector";
import { Socket } from "node:net";
import DevTools from 'devtools-protocol';
import { RequestBase } from "./Request";

/**
 * @returns Seconds since epoch with microsecond precision
 */
export function timestamp() {
  return Date.now() / 1000;
}

export enum EmitMode {
  DiagnosticsChannel,
  LogFull,
  LogSummary,
}

export interface InitOptions {
  logger?: Logger;
  emitModes?: EmitMode[];
}


function mapHeaders(headers: OutgoingHttpHeaders): DevTools.Network.Headers {
  const result: DevTools.Network.Headers = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    result[key] = value.toString();
  }
  return result;
}

export interface DiagnosticChannelHttpRequestStart {
  request: ClientRequest;
}

export interface DiagnosticChannelHttpRequestFinish {
  request: ClientRequest;
  response: IncomingMessage;
}

export interface Logger {
  debug: (...args: any[]) => void;
  log: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
}


export class RequestTracker {
  private startTime: {
    bigint: bigint,
    timestamp: number,
  };
  public readonly requestInfo: DevTools.Network.RequestWillBeSentEvent & { _handled: boolean };
  private resourceTiming: DevTools.Network.ResourceTiming = {
    requestTime: Date.now() / 1000,
    proxyStart: -1,
    proxyEnd: -1,
    dnsStart: -1,
    dnsEnd: -1,
    connectStart: -1,
    connectEnd: -1,
    sslStart: -1,
    sslEnd: -1,
    sendStart: -1,
    sendEnd: -1,
    workerStart: -1,
    workerReady: -1,
    workerFetchStart: -1,
    receiveHeadersStart: -1,
    workerRespondWithSettled: -1,
    pushStart: -1,
    pushEnd: -1,
    receiveHeadersEnd: -1,
  };

  public getResourceTiming(): DevTools.Network.ResourceTiming {
    return this.resourceTiming;
  }

  private secondsSinceInit(): number {
    return timestamp() - this.initTime;
  }

  private emit(name: string, data: any) {
    if (this.initOptions.emitModes!.includes(EmitMode.DiagnosticsChannel)) {
      this.inspectorSession.emit(name, data);
    }
    if (this.initOptions.emitModes!.includes(EmitMode.LogFull)) {
      this.initOptions.logger!.log(name, data);
    }
    if (this.initOptions.emitModes!.includes(EmitMode.LogSummary)) {
      let summary = `[${this.secondsSinceInit().toFixed(3)}] ${this.id} ${name}`;
      if (name === 'Network.requestWillBeSent') {
        summary += ` ${data.request.url}`;
      }  else if (name === 'Network.loadingFailed') {
        summary += ` ${data.errorText}`;
      } else if (name === 'Network.loadingFinished') {
        const lfE = data as DevTools.Network.LoadingFinishedEvent;
        const duration = lfE.timestamp - this.startTime.timestamp;
        summary += ` ${lfE.encodedDataLength} Bytes \ttook ${(duration * 1000).toFixed(3)}ms`;
      } else {
        return;
      }
      this.initOptions.logger!.log(summary);
    }
  }

  get logger(): Logger {
    return this.initOptions.logger!;
  }


  constructor(
    public readonly id: number,
    public readonly request: RequestBase,
    private readonly inspectorSession: inspector.Session,
    private readonly initOptions: InitOptions,
    private readonly initTime: number
  ) {
    this.startTime = {
      bigint: process.hrtime.bigint(),
      timestamp: timestamp(),
    }


    this.requestInfo = this.constructRequestInfo();
    const willBeHandled = request.listenerCount('response') > 0;
    if (request.socket) {
      this.handleSocket(request.socket);
    } else {
      request.once("socket", (socket) => this.handleSocket(socket));
    }
    request.once("error", (error) => this.handleFailure(error));
    request.once("response", (response) => this.handleHttpResponse(willBeHandled, response));
    this.handleRequestData();
    this.handleAbort();

  }

  handleFailure(error: Error): void {
    this.sendRequestWillBeSent();
    const failureInfo = this.constructFailureInfo(error, !error);
    this.emit('Network.loadingFailed', failureInfo);
    this.logger.debug(
      `RequestTracker: Failed request ${this.id} ${this.requestInfo.request.url}`,
      failureInfo
    );
  }

  constructFailureInfo(err: any, canceled: boolean): DevTools.Network.LoadingFailedEvent {
    const unhandled = err && this.request.listenerCount('error') === 0;
    var errorText = (unhandled ? '(unhandled) ' : '') + (err && err.code);
    return {
      requestId: this.id.toString(),
      timestamp: timestamp(),
      type: 'XHR',
      errorText: errorText,
      canceled: canceled
    };
  }

  private constructRequestInfo(): DevTools.Network.RequestWillBeSentEvent & { _handled: boolean } {
    const protocol = this.request.protocol;
    const host = this.request.host;
    const path = this.request.path;
    const url = `${protocol}//${host}${path}`;
    return {
      _handled: false,
      requestId: this.id.toString(),
      loaderId: process.pid.toString(),
      documentURL: 'TODO documentURL',
      type: 'XHR',
      wallTime: timestamp(),
      timestamp: timestamp(),
      redirectHasExtraInfo: false,
      request: {
        headers: this.request.getHeaders() as DevTools.Network.Headers,
        method: this.request.method,
        postData: "",
        initialPriority: 'Medium',
        referrerPolicy: 'no-referrer', // TODO get from request
        url,
      },
      initiator: {
        type: 'script',
      },
    };
  }

  private sendRequestWillBeSent() {
    if (this.requestInfo._handled) return;
    this.requestInfo._handled = true;

    this.emit('Network.requestWillBeSent', this.requestInfo);
  }

  private constructResponseInfo(
    response: IncomingMessage
  ): DevTools.Network.ResponseReceivedEvent {
    const protocol = this.request.protocol;
    const host = this.request.host;
    const path = this.request.path;
    const url = `${protocol}//${host}${path}`;
    return {
      requestId: this.id.toString(),
      loaderId: process.pid.toString(),
      timestamp: timestamp(),
      type: "XHR",
      hasExtraInfo: false,
      response: {
        url,
        status: response.statusCode as number,
        statusText: response.statusMessage as string,
        headers: mapHeaders(response.headers),
        securityState: 'neutral',
        mimeType: response.headers["content-type"] as string,
        connectionReused: this.request.reusedSocket,
        connectionId: this.id,
        encodedDataLength: -1,
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: this.resourceTiming,
        headersText: "TODO headersText",
        requestHeaders: mapHeaders(this.request.getHeaders()),
        requestHeadersText: "TODO requestHeadersText",
      },
    };
  }


  

  private handleAbort() {
    var abort = this.request.abort;
    this.request.abort = () => {
      var result = abort.apply(this.request);
      this.handleFailure(new Error("Request aborted"));
      return result;
    };
  }

  public handleHttpResponse(wasHandled: boolean, response: IncomingMessage) {

    this.stopSubTime("receiveHeadersEnd");

    // NOTE: If there is no other `response` listeners
    // handling of `response` event changes program behavior
    // Without our listener all data will be dumped, but we pause data by our listener.
    // Most simple solution here to `resume` data stream, instead of dump it,
    // otherwise we'll never get a data.
    if (!wasHandled && this.request.listenerCount('response') === 0)
      response.resume();

    const responseInfo = this.constructResponseInfo(response);

    this.emit("Network.responseReceived", responseInfo);
    this.logger.debug(
      `RequestTracker: Received response for request ${this.id} ${this.requestInfo.request.url}`,
      responseInfo
    );
    const push = response.push;
    let dataLength = 0;

    response.push = (chunk, encoding) => {
      if (chunk) {
        dataLength += chunk.length;
        this.emit("Network.dataReceived", {
          requestId: this.id.toString(),
          timestamp: timestamp(),
          dataLength: chunk.length,
          encodedDataLength: chunk.length,
        } satisfies DevTools.Network.DataReceivedEvent);
      }

      return push.call(response, chunk, encoding);
    };

    response.once("end", () => {
      response.push = push;


      this.emit("Network.loadingFinished", {
        requestId: this.id.toString(),
        timestamp: timestamp(),
        encodedDataLength: dataLength,
      } satisfies DevTools.Network.LoadingFinishedEvent);
    });

    this.logger.debug(
      `RequestTracker: Received response for request ${this.id} ${this.requestInfo.request.url}`
    );
  }

  private handleRequestData() {
    var oldWrite = this.request.write;

    this.request.write = (...args) => {
      this.logger.debug(
        `RequestTracker: Writing data for request ${this.id} ${this.requestInfo.request.url}`
      );
      this.requestInfo.request.postData += args[0] || "";
      return oldWrite.apply(this.request, args as any);
    };
  }

  public stopSubTime(
    key: Exclude<keyof RequestTracker["resourceTiming"], "requestTime">
  ) {
    const diff = process.hrtime.bigint() - this.startTime.bigint;
    this.resourceTiming[key] = Number(diff) / 1000000;
  }
}
