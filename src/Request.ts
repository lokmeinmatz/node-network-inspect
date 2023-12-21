import { ClientRequest, IncomingMessage, OutgoingHttpHeaders } from "http";
import { Socket } from "net";


export interface IResponse {
  statusCode: number;
  statusMessage: string;
  headers: DevTools.Network.Headers;
}

type RequestEventCallbacks = {
  failure: (error: Error) => void;
  dnsStart: () => void;
  connectStart: () => void;
  sendStart: () => void;
  sendEnd: () => void;
  responseReceived: (response: IResponse) => void;
  dataReceived: (chunkInfo: Pick<DevTools.Network.DataReceivedEvent, 'data' | 'dataLength' | 'encodedDataLength'>) => void;
  requestFinished: (dataLength: number) => void;
};

import DevTools from 'devtools-protocol';

export abstract class RequestBase {
  constructor(readonly rawRequest: ClientRequest | Request) {}

  abstract readonly url: string;
  abstract readonly method: string;
  abstract connectionReused: boolean;
  abstract readonly headers: DevTools.Network.Headers;
  postData: string = '';

  private events: Partial<Record<keyof RequestEventCallbacks, any[]>> = {};
  private subscribers: Partial<Record<keyof RequestEventCallbacks, Function[]>> = {};


  addEventListener<K extends keyof RequestEventCallbacks>(event: K, listener: RequestEventCallbacks[K]): this {
    if (!this.subscribers[event]) {
      this.subscribers[event] = [];
    }

    this.subscribers[event]!.push(listener);

    // If the event has already occurred, immediately call the callback
    if (this.events[event]) {
      (listener as any).apply(this, this.events[event] as Parameters<RequestEventCallbacks[K]>);
    }
    return this;
  }
  removeEventListener<K extends keyof RequestEventCallbacks>(event: K, listener: RequestEventCallbacks[K]): this {
    if (!this.subscribers[event]) {
      return this;
    }

    const index = this.subscribers[event]!.indexOf(listener);
    if (index !== -1) {
      this.subscribers[event]!.splice(index, 1);
    }
    return this;
  }

  dispatchEvent<K extends keyof RequestEventCallbacks>(event: K, ...args: Parameters<RequestEventCallbacks[K]>): this {
    this.events[event] = args;
    if (this.subscribers[event]) {
      for (const subscriber of this.subscribers[event]!) {
        subscriber(...args);
      }
    }
    return this;
  }
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

export class NodeHttpRequest extends RequestBase {
  
  get headers(): DevTools.Network.Headers {
    return mapHeaders(this.rawRequest.getHeaders());
  }
  get connectionReused(): boolean {
    return this.rawRequest.reusedSocket;
  }
  
  get url(): string {
    return `${this.rawRequest.protocol}//${this.rawRequest.host}${this.rawRequest.path}`;
  }
  
  get method(): string {
    return this.rawRequest.method;
  }

  constructor(readonly rawRequest: ClientRequest) {
    super(rawRequest);

    if (rawRequest.socket) {
      this.handleSocket(rawRequest.socket);
    } else {
      rawRequest.once("socket", (socket) => this.handleSocket(socket));
    }

    rawRequest.once('error', (error: Error) => this.dispatchEvent('failure', error));
    rawRequest.once('response', (response) => this.handleHttpResponse(false, response));

    const abort = rawRequest.abort;
    rawRequest.abort = () => {
      var result = abort.apply(rawRequest);
      this.dispatchEvent('failure', new Error("Request aborted"));
      return result;
    };

    const destroy = rawRequest.destroy;
    rawRequest.destroy = () => {
      var result = destroy.apply(rawRequest);
      this.dispatchEvent('failure', new Error("Request destroyed"));
      return result;
    };

    var write = rawRequest.write;
    rawRequest.write = (...args) => {
      this.postData += args[0] || "";
      return write.apply(rawRequest, args as any);
    };
  }


  private handleHttpResponse(wasHandled: boolean, response: IncomingMessage) {

    this.dispatchEvent('responseReceived', {
      statusCode: response.statusCode!,
      statusMessage: response.statusMessage!,
      headers: mapHeaders(response.headers),
    });

    // NOTE: If there is no other `response` listeners
    // handling of `response` event changes program behavior
    // Without our listener all data will be dumped, but we pause data by our listener.
    // Most simple solution here to `resume` data stream, instead of dump it,
    // otherwise we'll never get a data.
    if (!wasHandled && this.rawRequest.listenerCount('response') === 0)
      response.resume();

    const push = response.push;
    let dataLength = 0;

    response.push = (chunk, encoding) => {
      if (chunk) {
        dataLength += chunk.length;
        this.dispatchEvent('dataReceived', {
          dataLength: chunk.length,
          encodedDataLength: chunk.length,
          data: chunk.toString(),
        });
      }

      return push.call(response, chunk, encoding);
    };

    response.once("end", () => {
      response.push = push;

      this.dispatchEvent('requestFinished', dataLength);
    });
  }

  private handleSocket(socket: Socket) {
    this.dispatchEvent('dnsStart');
    socket.once('lookup', () => {
      this.dispatchEvent('connectStart');
    });

    socket.once('connect', () => {
      this.dispatchEvent('sendStart');
    });
    socket.once('secureConnect', () => {
      // TODO check how ssl works here
    });
 
    socket.once('end', () => {
      this.dispatchEvent('sendEnd');
    });
  }
}

export class UndiciHttpRequest extends RequestBase {
  connectionReused = false;
  headers: DevTools.Network.Headers = {};

  /**
   * from undici:request:create
   */
  constructor(readonly rawRequest: Request) {
    super(rawRequest);
    console.log(rawRequest);
    this.dispatchEvent('dnsStart');
    
  }

  /**
   * from undici:request:bodySent
   */
  public onBodySent() {
    this.dispatchEvent('sendEnd');
  }

  /**
   * undici:request:headers
   * response headers have been received, i.e. the response has been completed.
   */
  public onHeaders(response: Response) {
    this.dispatchEvent('responseReceived', {
      statusCode: 200,
      statusMessage: "OK",
      headers: [...response.headers.entries()].reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {} as DevTools.Network.Headers),
    });
  }

  /**
   * from undici:client:sendHeaders
   * right before the first byte of the request is written to the socket.
   */
  public onSendHeaders() {
    this.dispatchEvent('sendStart');
  }

  /**
   * from undici:request:trailers
   */
  public onTrailers(response: Response) {
    // TODO body size
    this.dispatchEvent('requestFinished', 0);
  }

  /**
   * from undici:request:error
   */
  public onError(error: Error) {
    this.dispatchEvent('failure', error);
  }

  /**
   * from undici:client:connectError
   */
  public onConnectError(error: Error) {
    this.dispatchEvent('failure', error);
  }

  get url(): string {
    if (this.rawRequest.url) return this.rawRequest.url;
    // @ts-ignore
    return this.rawRequest.origin + this.rawRequest.path;
  }

  get method(): string {
    return this.rawRequest.method;
  }
}
