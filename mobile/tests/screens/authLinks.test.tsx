import { screen, userEvent } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import LoginScreen from '../../app/(auth)/login';
import SignupScreen from '../../app/(auth)/signup';
import WelcomeScreen from '../../app/(auth)/welcome';
import { mountScreen } from '../support/mount';
import { resetRouter, routerRecord } from '../support/router';

jest.mock('expo-router');

beforeEach(() => resetRouter());

describe('moving between sign-up and sign-in', () => {
  it('sign-up offers the way to log in, replacing the screen rather than stacking another', async () => {
    await mountScreen(<SignupScreen />);
    await userEvent.press(screen.getByTestId('signup-to-login'));
    expect(routerRecord.replace).toContainEqual('/(auth)/login');
  });

  it('sign-in offers the way to create an account', async () => {
    await mountScreen(<LoginScreen />);
    await userEvent.press(screen.getByTestId('login-to-signup'));
    expect(routerRecord.replace).toContainEqual('/(auth)/signup');
  });

  it('both say in a line what the screen is for', async () => {
    await mountScreen(<SignupScreen />);
    expect(screen.getByText(COPY.signup.subtitle)).toBeTruthy();
  });
});

describe('the welcome screen', () => {
  it('says what the app does in three lines above the two ways in', async () => {
    await mountScreen(<WelcomeScreen />);
    expect(screen.getByText(COPY.welcome.features.offline)).toBeTruthy();
    expect(screen.getByText(COPY.welcome.features.receipts)).toBeTruthy();
    expect(screen.getByText(COPY.welcome.features.share)).toBeTruthy();
    expect(screen.getByTestId('welcome-signup')).toBeTruthy();
  });
});
