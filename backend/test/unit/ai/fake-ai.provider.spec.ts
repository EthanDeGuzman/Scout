import { FakeAIProvider } from '../../../src/ai/fake-ai.provider';
import { EmailCategory } from '../../../src/modules/emails/email-category.enum';

const email = (subject: string, bodyText = '') => ({
  subject,
  senderName: 'Someone',
  senderAddress: 'someone@example.com',
  bodyText,
});

describe('FakeAIProvider', () => {
  const provider = new FakeAIProvider();

  it.each([
    ['Interview invitation', EmailCategory.INTERVIEW],
    ['Weekly digest, unsubscribe anytime', EmailCategory.NEWSLETTER],
    ['A new role for you', EmailCategory.JOB_OPPORTUNITY],
    ['Lunch on Friday?', EmailCategory.OTHER],
  ])('classifies "%s" as %s', async (subject, expected) => {
    const result = await provider.classifyEmail(email(subject));

    expect(result.category).toBe(expected);
  });

  it('marks its results as fake', async () => {
    const result = await provider.classifyEmail(email('Hi'));

    expect(result.modelName).toBe('fake');
    expect(result.promptVersion).toBe('fake_v1');
  });
});
