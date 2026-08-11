import { MainLayout } from './components/Layout/MainLayout';
import { ProjectProvider } from './context/ProjectContext';
import { TerminalProvider } from './context/TerminalContext';
import { ExplanationProvider } from './context/ExplanationContext';
import { SettingsProvider } from './context/SettingsContext';

function App() {
  return (
    <ProjectProvider>
      <TerminalProvider>
        <ExplanationProvider>
          <SettingsProvider>
            <MainLayout />
          </SettingsProvider>
        </ExplanationProvider>
      </TerminalProvider>
    </ProjectProvider>
  );
}

export default App;
