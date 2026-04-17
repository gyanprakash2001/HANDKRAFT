declare module 'react-native-razorpay' {
  export interface RazorpayPrefill {
    name?: string;
    email?: string;
    contact?: string;
  }

  export interface RazorpayCheckoutOptions {
    key: string;
    amount: number;
    currency: string;
    order_id: string;
    name?: string;
    description?: string;
    image?: string;
    prefill?: RazorpayPrefill;
    theme?: {
      color?: string;
    };
  }

  export interface RazorpaySuccessResponse {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }

  export interface RazorpayErrorResponse {
    code?: number;
    description?: string;
    source?: string;
    step?: string;
    reason?: string;
    metadata?: {
      order_id?: string;
      payment_id?: string;
    };
  }

  interface RazorpayCheckout {
    open(options: RazorpayCheckoutOptions): Promise<RazorpaySuccessResponse>;
  }

  const RazorpayCheckout: RazorpayCheckout;
  export default RazorpayCheckout;
}
