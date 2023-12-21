import { ClientRequest } from "http";
import { Socket } from "net";

type RequestEventCallbacks = {
  failure: (error: Error) => void;
  dnsStart: () => void;
  connectStart: () => void;
  sendStart: () => void;
  sendEnd: () => void;
  receiveHeadersStart: () => void;
  receiveContentStart: () => void;
  responseReceived: (response: any) => void;
};

export abstract class RequestBase {
  constructor(readonly rawRequest: ClientRequest | Request) {}

  abstract readonly url: string;
  abstract readonly method: string;

  private events: Partial<Record<keyof RequestEventCallbacks, any[]>> = {};
  private subscribers: Partial<Record<keyof RequestEventCallbacks, Function[]>> = {};


  addEventListener<K extends keyof RequestEventCallbacks>(event: K, listener: RequestEventCallbacks[K]): this {
    if (!this.subscribers[event]) {
      this.subscribers[event] = [];
    }

    this.subscribers[event]!.push(listener);

    // If the event has already occurred, immediately call the callback
    if (this.events[event]) {
      listener.apply(this, this.events[event] as any);
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

export class NodeHttpRequest extends RequestBase {
  
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
    rawRequest.once('response', (response) => this.handleHttpResponse(response));
  }

  private handleHttpResponse(response: any) {
    this.dispatchEvent('responseReceived', response);
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
    // TODO do on Tracker
    this.sendRequestWillBeSent();
  }
}

export class UndiciHttpRequest extends RequestBase {
  constructor(readonly rawRequest: Request) {
    super(rawRequest);
  }

  get url(): string {
    return this.rawRequest.url;
  }

  get method(): string {
    return this.rawRequest.method;
  }
}
