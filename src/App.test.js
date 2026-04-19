import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the StudySpace booking app without crashing', () => {
  render(<App />);
  // Default page is the campus map
  const titleElement = screen.getByText(/Campus Map/i);
  expect(titleElement).toBeInTheDocument();
});