export default {
  id: "msg_test_0001",
  type: "email.received",
  from: {
    address: "alice@example.com",
  },
  to: [
    {
      address: "support@yourdomain.com",
    },
  ],
  subject: "Re: my order",
  text: "Hey — any update on order #1234?",
  html: "<p>Hey — any update on order #1234?</p>",
  threadId: "thr_abc123",
  auth: {
    spf: "pass",
    dkim: "pass",
    dmarc: "pass",
    spam: "ham",
  },
  attachments: [],
};
