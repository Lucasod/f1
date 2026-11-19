"""Stripe provider adapter — owns all Stripe SDK calls.

The application billing domain never calls stripe directly; it goes through
this adapter so tests can replace the external dependency (DIP).
"""

import stripe
from django.conf import settings


class StripeAdapterError(Exception):
    """Raised when the Stripe adapter cannot complete an operation."""


class StripeAdapter:
    """Thin wrapper over the Stripe Python SDK."""

    def __init__(self):
        api_key = settings.STRIPE_API_KEY
        if not api_key:
            raise StripeAdapterError("Stripe API key is not configured")
        if not api_key.startswith("sk_test_") and not api_key.startswith("rk_test_"):
            raise StripeAdapterError(
                "Stripe API key is not in test mode. Live mode credentials are not allowed."
            )
        stripe.api_key = api_key
        stripe.api_version = settings.STRIPE_API_VERSION

    def create_customer(self, idempotency_key, metadata=None):
        """Create or retrieve a Stripe Customer for a workspace.

        Uses idempotency_key as the dedup mechanism - Stripe guarantees that
        calling create with the same idempotency_key returns the same customer.
        Does NOT use email-based lookup, which could match customers from
        different tenants.
        """
        try:
            customer = stripe.Customer.create(
                idempotency_key=idempotency_key,
                metadata=metadata or {},
            )
            return customer.id
        except stripe.error.StripeError as exc:
            raise StripeAdapterError(f"Failed to create customer: {exc}") from exc

    def _load_stripe_customer(self, workspace_id, workspace_name, billing_id):
        """Load existing Stripe Customer or create a new one.

        Uses idempotency_key for deduplication to avoid duplicate customers.
        Never uses email-based lookup, which could match customers from
        different tenants.
        """
        idempotency_key = f"workspace-{workspace_id}-customer"
        metadata = {
            "workspace_id": str(workspace_id),
            "workspace_name": workspace_name,
            "billing_id": str(billing_id),
        }

        try:
            customer_id = self.create_customer(
                idempotency_key=idempotency_key,
                metadata=metadata,
            )
            return customer_id
        except StripeAdapterError:
            # Re-raise for the caller to handle
            raise

    def create_checkout_session(
        self,
        customer_id,
        price_id,
        success_url,
        cancel_url,
        metadata=None,
    ):
        """Create a Stripe Checkout Session for a subscription."""
        try:
            session = stripe.checkout.Session.create(
                customer=customer_id,
                payment_method_types=["card"],
                line_items=[{"price": price_id, "quantity": 1}],
                mode="subscription",
                success_url=success_url,
                cancel_url=cancel_url,
                metadata=metadata or {},
                subscription_data={
                    "metadata": metadata or {},
                },
            )
            return {
                "session_id": session.id,
                "session_url": session.url,
                "expires_at": session.expires_at,
            }
        except stripe.error.StripeError as exc:
            raise StripeAdapterError(f"Failed to create checkout session: {exc}") from exc

    def cancel_subscription(self, subscription_id, at_period_end=False):
        """Cancel a Stripe subscription."""
        try:
            subscription = stripe.Subscription.modify(
                subscription_id,
                cancel_at_period_end=at_period_end,
            )
            return {
                "subscription_id": subscription.id,
                "status": subscription.status,
                "cancel_at_period_end": subscription.cancel_at_period_end,
                "current_period_end": subscription.current_period_end,
            }
        except stripe.error.StripeError as exc:
            raise StripeAdapterError(f"Failed to cancel subscription: {exc}") from exc

    def create_portal_session(self, customer_id, return_url):
        """Create a Stripe Billing Portal session."""
        try:
            session = stripe.billingportal.Session.create(
                customer=customer_id,
                return_url=return_url,
            )
            return {"portal_url": session.url}
        except stripe.error.StripeError as exc:
            raise StripeAdapterError(f"Failed to create portal session: {exc}") from exc

    def get_subscription(self, subscription_id):
        """Retrieve a Stripe subscription."""
        try:
            subscription = stripe.Subscription.retrieve(subscription_id)
            return {
                "subscription_id": subscription.id,
                "status": subscription.status,
                "cancel_at_period_end": subscription.cancel_at_period_end,
                "current_period_end": subscription.current_period_end,
                "items": [
                    {
                        "price_id": item.price.id,
                        "quantity": item.quantity,
                    }
                    for item in subscription.items.data
                ],
            }
        except stripe.error.StripeError as exc:
            raise StripeAdapterError(f"Failed to retrieve subscription: {exc}") from exc

    def construct_webhook_event(self, payload, sig_header, tolerance=300):
        """Verify and construct a Stripe webhook event from raw payload + signature."""
        try:
            event = stripe.Webhook.construct_event(
                payload,
                sig_header,
                settings.STRIPE_WEBHOOK_SECRET,
                tolerance=tolerance,
            )
            return event
        except (stripe.error.SignatureVerificationError, ValueError) as exc:
            raise StripeAdapterError(f"Invalid webhook signature: {exc}") from exc

    def retrieve_checkout_session(self, session_id):
        """Retrieve a Stripe Checkout Session."""
        try:
            session = stripe.checkout.Session.retrieve(session_id)
            return {
                "session_id": session.id,
                "customer": session.customer,
                "subscription": session.subscription,
                "metadata": session.metadata,
                "payment_status": session.payment_status,
                "status": session.status,
            }
        except stripe.error.StripeError as exc:
            raise StripeAdapterError(f"Failed to retrieve checkout session: {exc}") from exc
