import { firestore as adminFirestore } from "firebase-admin";
import { handler, logger } from "firebase-functions";
import { twiml, validateRequest } from "twilio";
import { initialize, getFunctionsUrl } from "./utils";
import config from "./config";

export const statusCallback = handler.https.onRequest(async (req, res) => {
  initialize();
  const {
    twilio: { authToken },
  } = config;
  const signature = req.get("x-twilio-signature");
  const url = getFunctionsUrl("statusCallback");
  const params = req.body;
  if (!signature) {
    return res
      .type("text/plain")
      .status(400)
      .send(
        "No signature header error - X-Twilio-Signature header does not exist, maybe this request is not coming from Twilio."
      );
  }
  if (typeof authToken !== "string") {
    return res
      .type("text/plain")
      .status(500)
      .send(
        "Webhook Error - we attempted to validate this request without first configuring our auth token."
      );
  }
  if (!validateRequest(authToken, signature, url, params)) {
    return res
      .type("text/plain")
      .status(403)
      .send("Twilio Request Validation Failed");
  }
  const { MessageSid, MessageStatus } = req.body;

  if (typeof MessageSid !== "string") {
    return res
      .type("text/plain")
      .status(400)
      .send("Webhook error - No MessageSid found.");
  }

  const firestore = adminFirestore();
  const collection = firestore.collection(config.messageCollection);
  logger.log(`Attempting status update for message: ${MessageSid}`);

  try {
    const query = await collection
      .where("delivery.info.messageSid", "==", MessageSid)
      .limit(1)
      .get();
    if (query.docs.length === 0) {
      logger.error(
        `Could not find document for message with SID: ${MessageSid}`
      );
    } else {
      const ref = query.docs[0].ref;
      logger.log(
        `Found document for message ${MessageSid} with ref ${String(ref.path)}`
      );
      await adminFirestore().runTransaction((transaction) => {
        transaction.update(ref, "delivery.info.status", MessageStatus);
        return Promise.resolve();
      });
    }
  } catch (error) {
    logger.error(error);
  }
  res.contentType("text/xml");
  res.send(new twiml.MessagingResponse().toString());
  return;
});
