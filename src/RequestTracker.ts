// inspired by https://github.com/node-inspector/node-inspector/blob/79e01c049286374f86dd560742a614019c02402f/lib/Injections/NetworkAgent.js#L252


import DevTools from 'devtools-protocol';
import type {
  ClientRequest,
  IncomingMessage,
  OutgoingHttpHeaders,
} from "node:http";
import * as inspector from "node:inspector";
import { IResponse, RequestBase } from "./Request";

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

  private emit(name: string, data: any) {
    if (this.initOptions.emitModes!.includes(EmitMode.DiagnosticsChannel)) {
      this.inspectorSession.emit(name, data);
    }
    if (this.initOptions.emitModes!.includes(EmitMode.LogFull)) {
      this.initOptions.logger!.log(name, data);
    }
    if (this.initOptions.emitModes!.includes(EmitMode.LogSummary)) {
      let summary = `[${this.timestamp().toFixed(3)}] ${this.id} ${name}`;
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
      timestamp: this.timestamp(),
    }


    this.requestInfo = this.constructRequestInfo();
    console.log("reqInfo", this.requestInfo);
    request.addEventListener('dnsStart', () => {
      this.stopSubTime('dnsStart');
    });

    // cant rely on this, as sockets are reused
    request.addEventListener('connectStart', () => {
      this.stopSubTime('dnsEnd');
      this.stopSubTime('connectStart');
    });
    
    request.addEventListener('sendStart', () => {
      this.stopSubTime('connectEnd');
      this.sendRequestWillBeSent();
      this.stopSubTime('sendStart');
    });

    request.addEventListener('sendEnd', () => {
      this.stopSubTime('sendEnd');
    });

    request.addEventListener('responseReceived', (response) => {
      this.stopSubTime('receiveHeadersEnd');
      this.emit('Network.responseReceived', {
        ...this.constructResponseInfo(response),
        timestamp: this.timestamp(),
      } satisfies DevTools.Network.ResponseReceivedEvent);
    });

    request.addEventListener('dataReceived', (response) => {
      this.emit('Network.dataReceived', {
        ...response,
        requestId: this.id.toString(),
        timestamp: this.timestamp(),
      } satisfies DevTools.Network.DataReceivedEvent);
    });

    request.addEventListener('requestFinished', (dataLength) => {
      this.emit('Network.loadingFinished', {
        requestId: this.id.toString(),
        timestamp: this.timestamp(),
        encodedDataLength: dataLength,
      } satisfies DevTools.Network.LoadingFinishedEvent);
    });

    request.addEventListener('failure', (error) => {
      this.handleFailure(error);
    });
  }

  private timestamp() {
    return timestamp() - this.initTime; 
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

  constructFailureInfo(err: Error, canceled: boolean): DevTools.Network.LoadingFailedEvent {
    return {
      requestId: this.id.toString(),
      timestamp: this.timestamp(),
      type: 'XHR',
      errorText: err.message,
      canceled: canceled
    };
  }

  private constructRequestInfo(): DevTools.Network.RequestWillBeSentEvent & { _handled: boolean } {
    return {
      _handled: false,
      requestId: this.id.toString(),
      loaderId: process.pid.toString(),
      documentURL: 'TODO documentURL',
      type: 'XHR',
      wallTime: timestamp(),
      timestamp: this.timestamp(),
      redirectHasExtraInfo: false,
      request: {
        headers: this.request.headers,
        method: this.request.method,
        postData: "",
        initialPriority: 'Medium',
        referrerPolicy: 'no-referrer', // TODO get from request
        url: this.request.url,
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
    response: IResponse
  ): DevTools.Network.ResponseReceivedEvent {
    return {
      requestId: this.id.toString(),
      loaderId: process.pid.toString(),
      timestamp: this.timestamp(),
      type: "XHR",
      hasExtraInfo: false,
      response: {
        url: this.request.url,
        status: response.statusCode as number,
        statusText: response.statusMessage as string,
        headers: response.headers,
        securityState: 'neutral',
        mimeType: response.headers["content-type"] as string,
        connectionReused: this.request.connectionReused,
        connectionId: this.id,
        encodedDataLength: -1,
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: this.resourceTiming,
        headersText: "TODO headersText",
        requestHeaders: this.request.headers,
        requestHeadersText: "TODO requestHeadersText",
      },
    };
  }

  public stopSubTime(
    key: Exclude<keyof RequestTracker["resourceTiming"], "requestTime">
  ) {
    const diff = process.hrtime.bigint() - this.startTime.bigint;
    this.resourceTiming[key] = Number(diff) / 1000000;
  }
}
