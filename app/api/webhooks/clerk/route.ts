import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { WebhookEvent } from '@clerk/nextjs/server';
import { createUser, updateUser, deleteUser, getUserById } from '@/lib/users'; // Import necessary functions, including deleteUser
import { User } from '@prisma/client';

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    throw new Error('Please add CLERK_WEBHOOK_SECRET from Clerk Dashboard to .env or .env.local');
  }

  const headerPayload = headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response('Error occurred -- no svix headers', { status: 400 });
  }

  const payload = await req.json();
  const body = JSON.stringify(payload);
  const wh = new Webhook(WEBHOOK_SECRET);

  let evt: WebhookEvent;

  try {
    evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error('Error verifying webhook:', err);
    return new Response('Error occurred', { status: 400 });
  }

  const eventType = evt.type;
  const eventData = evt.data;

  if (eventType === 'user.created' || eventType === 'user.updated') {
    const { id, email_addresses, first_name, last_name, image_url } = eventData;

    if (!id || !email_addresses) {
      return new Response('Error occurred -- missing data', { status: 400 });
    }

    // Check if the user already exists in the database by clerkUserId
    const existingUserResponse = await getUserById({ clerkUserId: id });

    if (existingUserResponse.error) {
      // Handle error if getUserById failed
      console.error('Error fetching existing user:', existingUserResponse.error);
      return new Response('Error occurred', { status: 500 });
    }

    const existingUser = existingUserResponse.user;

    // Prepare user data
    const userData: Partial<User> = {
      clerkUserId: id,
      email: email_addresses[0].email_address,
      ...(first_name ? { firstName: first_name } : {}),
      ...(last_name ? { lastName: last_name } : {}),
      ...(image_url ? { imageUrl: image_url } : {}),
    };

    // Decide whether to create or update the user
    if (existingUser) {
      await updateUser(existingUser.id, userData); // Update existing user
    } else {
      await createUser(userData as User); // Create new user
    }
  } else if (eventType === 'user.deleted') {
    const { id } = eventData;

    if (!id) {
      return new Response('Error occurred -- missing user id', { status: 400 });
    }

    const deleteResult = await deleteUser(id);

    if (deleteResult.error) {
      console.error('Error deleting user:', deleteResult.error);
      return new Response('Error occurred', { status: 500 });
    }
  }

  return new Response('', { status: 200 });
}
