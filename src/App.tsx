// App.tsx
import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  memo,
} from "react";
import { OpenAI } from "openai";
import { z } from "zod";
import MDEditor from "@uiw/react-md-editor";
import { zodResponseFormat } from "openai/helpers/zod";
import { jsPDF } from "jspdf";
import MarkdownIt from "markdown-it";

const apiKey = process.env.REACT_APP_OPENROUTER_API_KEY;
if (!apiKey) throw new Error("REACT_APP_OPENROUTER_API_KEY is not set");

const openai = new OpenAI({
  apiKey,
  baseURL: "https://openrouter.ai/api/v1",
  dangerouslyAllowBrowser: true,
});

/**
 * Schema for AI-generated resume improvement suggestions
 */
const suggestionResponseSchema = z.object({
  suggestions: z
    .array(
      z.object({
        section: z
          .string()
          .describe("The regex expression to match the section of the resume"),
        suggestion: z.string().describe("The suggestion for the section"),
      })
    )
    .optional()
    .describe(
      "The suggestions for the resume, return an empty array if there are no suggestions"
    ),
});

type Suggestion = z.infer<typeof suggestionResponseSchema>;

/**
 * Available AI models for generating suggestions
 */
const models = [
  "openai/o3-mini",
  "deepseek/deepseek-r1",
  "openai/gpt-4o-mini",
  "qwen/qwq-32b",
  "deepseek/deepseek-chat",
] as const;
type Model = (typeof models)[number];

/**
 * Creates a debounced version of a function that only executes after waiting
 *
 * @param func - The function to debounce
 * @param wait - The number of milliseconds to delay
 * @returns A debounced version of the function
 */
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function (...args: Parameters<T>): void {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Custom hook for managing resume storage in localStorage
 *
 * @returns Object with methods for interacting with resume data
 */
function useResumeStorage() {
  /**
   * Retrieves all resumes from localStorage
   *
   * @returns Record mapping resume names to content
   */
  const getResumes = useCallback((): Record<string, string> => {
    try {
      return JSON.parse(localStorage.getItem("resumes") || "{}");
    } catch (error) {
      console.error("Failed to parse resumes from localStorage:", error);
      return {};
    }
  }, []);

  /**
   * Gets an array of all resume names
   *
   * @returns Array of resume names
   */
  const getResumeNames = useCallback((): string[] => {
    return Object.keys(getResumes());
  }, [getResumes]);

  /**
   * Retrieves content for a specific resume
   *
   * @param name - The name of the resume
   * @returns The resume content as a string
   */
  const getResumeContent = useCallback(
    (name: string): string => {
      return getResumes()[name] || "";
    },
    [getResumes]
  );

  /**
   * Saves a resume to localStorage
   *
   * @param name - The name of the resume
   * @param content - The content to save
   */
  const saveResume = useCallback(
    (name: string, content: string): void => {
      try {
        const savedResumes = getResumes();
        savedResumes[name] = content;
        localStorage.setItem("resumes", JSON.stringify(savedResumes));
      } catch (error) {
        console.error("Failed to save resume to localStorage:", error);
      }
    },
    [getResumes]
  );

  /**
   * Deletes a resume from localStorage
   *
   * @param name - The name of the resume to delete
   */
  const deleteResume = useCallback(
    (name: string): void => {
      try {
        const savedResumes = getResumes();
        delete savedResumes[name];
        localStorage.setItem("resumes", JSON.stringify(savedResumes));
      } catch (error) {
        console.error("Failed to delete resume from localStorage:", error);
      }
    },
    [getResumes]
  );

  return {
    getResumes,
    getResumeNames,
    getResumeContent,
    saveResume,
    deleteResume,
  };
}

/**
 * Props for the Modal component
 */
type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

/**
 * A reusable modal dialog component
 *
 * @param props - Component props
 * @returns Modal component or null if not open
 */
const Modal: React.FC<ModalProps> = ({ isOpen, onClose, children }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-lg w-96">{children}</div>
    </div>
  );
};

/**
 * Props for suggestion components
 */
type SuggestionComponentProps = {
  children?: React.ReactNode;
  [key: string]: any;
};

/**
 * Main application component for the Markdown Resume Builder
 */
const App: React.FC = () => {
  const resumeStorage = useResumeStorage();
  const [content, setContent] = useState<string>("");
  const [suggestions, setSuggestions] = useState<
    Suggestion["suggestions"] | null
  >(null);
  const [selectedModel, setSelectedModel] = useState<Model>("openai/o3-mini");
  const [previewMode, setPreviewMode] = useState<"edit" | "preview" | "live">(
    window.innerWidth >= 768 ? "live" : "edit"
  );
  const [resumes, setResumes] = useState<string[]>([]);
  const [currentResume, setCurrentResume] = useState("My-Resume");
  const [showNewResumeModal, setShowNewResumeModal] = useState(false);
  const [showDeleteResumeModal, setShowDeleteResumeModal] = useState(false);
  const [newResumeName, setNewResumeName] = useState("");
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [editorHeight, setEditorHeight] = useState(
    window.innerWidth >= 768 ? "80vh" : "60vh"
  );
  const newResumeInputRef = useRef<HTMLInputElement>(null);
  // Add a flag to enable/disable automatic suggestions
  const [autoSuggest, setAutoSuggest] = useState<boolean>(true);
  // Add a boolean to track if API is in progress
  const isApiInProgressRef = useRef<boolean>(false);
  // Keep track of last successful content for rate limiting
  const lastProcessedContentRef = useRef<string>("");
  // Add a cooldown timer for API calls
  const apiCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Store current suggestions in a ref to prevent circular dependencies
  const suggestionsRef = useRef<Suggestion["suggestions"] | null>(null);
  // Store current content in a ref to avoid dependency issues
  const contentRef = useRef<string>("");
  // Store selected model in a ref
  const selectedModelRef = useRef<Model>("openai/o3-mini");

  // Keep refs in sync with state
  useEffect(() => {
    contentRef.current = content;
    suggestionsRef.current = suggestions;
    selectedModelRef.current = selectedModel;
  }, [content, suggestions, selectedModel]);

  /**
   * Effect: Updates editor height and preview mode on window resize
   */
  useEffect(() => {
    const handleResize = debounce(() => {
      setEditorHeight(window.innerWidth >= 768 ? "80vh" : "60vh");
      setPreviewMode(window.innerWidth >= 768 ? "live" : "edit");
    }, 200);

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  /**
   * Effect: Initializes resumes from localStorage on mount
   */
  useEffect(() => {
    const resumeNames = resumeStorage.getResumeNames();
    setResumes(resumeNames);

    // If we have no resumes, create a default one
    if (resumeNames.length === 0) {
      resumeStorage.saveResume("My-Resume", "");
      setResumes(["My-Resume"]);
    }
  }, []);

  /**
   * Effect: Loads content when current resume changes
   */
  useEffect(() => {
    const savedContent = resumeStorage.getResumeContent(currentResume);
    setContent(savedContent);
  }, [currentResume]);

  /**
   * Handles content changes from the markdown editor
   *
   * @param value - New content value
   */
  const handleContentChange = useCallback((value?: string) => {
    setContent(value || "");
  }, []);

  /**
   * Toggles between edit and preview modes
   */
  const togglePreviewMode = useCallback(() => {
    setPreviewMode((prev) => (prev === "edit" ? "preview" : "edit"));
  }, []);

  /**
   * Toggles auto-suggestions on/off
   */
  const toggleAutoSuggest = useCallback(() => {
    setAutoSuggest((prev) => !prev);
  }, []);

  /**
   * Generates resume improvement suggestions using AI
   */
  const generateSuggestions = useCallback(async () => {
    // Use refs instead of state to avoid dependency issues
    const currentContent = contentRef.current;
    const currentSuggestions = suggestionsRef.current;
    const currentModel = selectedModelRef.current;

    if (!currentContent.trim() || isApiInProgressRef.current) {
      return;
    }

    // Skip if content is the same as last processed content
    if (currentContent === lastProcessedContentRef.current) {
      return;
    }

    // Apply rate limiting
    if (apiCooldownRef.current) {
      return;
    }

    try {
      isApiInProgressRef.current = true;
      setIsLoadingSuggestions(true);

      // Set a cooldown to prevent excessive API calls
      apiCooldownRef.current = setTimeout(() => {
        apiCooldownRef.current = null;
      }, 5000); // 5-second cooldown between API calls

      const completion = await openai.beta.chat.completions.parse({
        model: currentModel,
        messages: [
          {
            role: "system",
            content:
              "Provide resume improvement suggestions. This also includes markdown formatting suggestions. Include all previous suggestions in your output (if still a valid suggestion).",
          },
          {
            role: "user",
            content: `Current resume: ${currentContent}\nPrevious suggestions: ${JSON.stringify(
              currentSuggestions
            )}`,
          },
        ],
        response_format: zodResponseFormat(
          suggestionResponseSchema,
          "suggestions"
        ),
        reasoning_effort: currentModel === "openai/o3-mini" ? "low" : undefined,
      });

      lastProcessedContentRef.current = currentContent;
      const response = completion.choices[0].message.parsed?.suggestions;

      if (!response || response.length === 0) {
        setSuggestions(null);
        return;
      }
      setSuggestions(response);
    } catch (error) {
      console.error("Failed to generate suggestions:", error);
      // If API fails, clear the cooldown after a short delay
      if (apiCooldownRef.current) {
        clearTimeout(apiCooldownRef.current);
        apiCooldownRef.current = setTimeout(() => {
          apiCooldownRef.current = null;
        }, 10000); // Longer cooldown after failure
      }
    } finally {
      setIsLoadingSuggestions(false);
      isApiInProgressRef.current = false;
    }
  }, []); // No dependencies to avoid circular dependencies

  // Create a debounced version of generateSuggestions with a longer delay
  const debouncedGenerateSuggestions = useMemo(
    () => debounce(generateSuggestions, 3000), // Increase debounce to 3 seconds
    [generateSuggestions]
  );

  /**
   * Effect: Save content to localStorage when it changes
   */
  useEffect(() => {
    resumeStorage.saveResume(currentResume, content);
  }, [content, currentResume, resumeStorage]);

  /**
   * Effect: Trigger suggestions generation when needed
   */
  useEffect(() => {
    if (autoSuggest && content.trim()) {
      debouncedGenerateSuggestions();
    }
  }, [autoSuggest, content, debouncedGenerateSuggestions]);

  /**
   * Exports the current resume as a PDF document
   */
  const exportPDF = useCallback(() => {
    if (!content) return;

    // Create a markdown parser with more options
    const md = new MarkdownIt({
      html: true,
      breaks: true,
      linkify: true,
      typographer: true,
    });

    // Parse markdown to HTML
    const htmlContent = md.render(content);

    // Create a temporary div for rendering
    const tempDiv = document.createElement("div");
    tempDiv.className = "markdown-body p-8 bg-white";
    tempDiv.style.width = "8.5in"; // Letter width
    tempDiv.innerHTML = htmlContent;

    // Keep the element hidden
    tempDiv.style.position = "absolute";
    tempDiv.style.left = "-9999px";
    document.body.appendChild(tempDiv);

    // Create PDF document
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "letter",
    });

    // Define constants for formatting
    const pageHeight = pdf.internal.pageSize.getHeight();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 50;
    let currentY = margin;

    /**
     * Adds text to the PDF with proper spacing and pagination
     *
     * @param text - The text to add
     * @param fontSize - Font size in points
     * @param isBold - Whether the text should be bold
     * @param extraSpace - Extra vertical space to add after text
     */
    const addText = (
      text: string,
      fontSize: number,
      isBold: boolean = false,
      extraSpace: number = 10
    ) => {
      pdf.setFontSize(fontSize);
      pdf.setFont("helvetica", isBold ? "bold" : "normal");

      // Split text to fit page width
      const textLines = pdf.splitTextToSize(text, pageWidth - margin * 2);

      // Check if we need a new page
      const textHeight = textLines.length * (fontSize * 1.2);
      if (currentY + textHeight > pageHeight - margin) {
        pdf.addPage();
        currentY = margin;
      }

      // Add text
      pdf.text(textLines, margin, currentY);

      // Update position
      currentY += textHeight + extraSpace;
    };

    /**
     * Processes an HTML node and converts it to PDF format
     *
     * @param node - The HTML element to process
     */
    const processNode = (node: HTMLElement) => {
      // Skip empty nodes
      if (!node.textContent?.trim()) return;

      const tagName = node.tagName?.toLowerCase() || "";
      const text = node.textContent.trim();

      // Process based on tag
      switch (tagName) {
        case "h1":
          // Add extra space before headings (except at the top of page)
          if (currentY > margin + 10) currentY += 20;
          addText(text, 24, true, 20);
          break;

        case "h2":
          if (currentY > margin + 10) currentY += 16;
          addText(text, 20, true, 16);
          break;

        case "h3":
          if (currentY > margin + 10) currentY += 12;
          addText(text, 16, true, 12);
          break;

        case "p":
          // Regular paragraph
          addText(text, 12, false, 12);
          break;

        case "ul":
        case "ol":
          // For lists, we need to process each child
          Array.from(node.children).forEach((item) => {
            if (item.tagName.toLowerCase() === "li") {
              // Add bullet for list items with indentation
              pdf.setFontSize(12);
              pdf.setFont("helvetica", "normal");

              const bulletText = "• " + item.textContent?.trim();
              const textLines = pdf.splitTextToSize(
                bulletText,
                pageWidth - margin * 2 - 20
              );

              if (currentY + textLines.length * 14 > pageHeight - margin) {
                pdf.addPage();
                currentY = margin;
              }

              // Add indent for bullets
              pdf.text(textLines, margin + 10, currentY);
              currentY += textLines.length * 14 + 5;
            }
          });
          break;

        default:
          // Default handling for other elements
          addText(text, 12, false, 10);
      }
    };

    // Process all child nodes
    Array.from(tempDiv.children).forEach((node) => {
      processNode(node as HTMLElement);
    });

    // Save the PDF
    pdf.save(`${currentResume}-resume.pdf`);

    // Clean up
    document.body.removeChild(tempDiv);
  }, [content, currentResume]);

  /**
   * Handles creating a new resume
   */
  const handleCreateNewResume = useCallback(() => {
    if (newResumeName && !resumes.includes(newResumeName)) {
      const newResumesList = [...resumes, newResumeName];
      setResumes(newResumesList);

      resumeStorage.saveResume(newResumeName, "");
      setCurrentResume(newResumeName);
      setContent("");

      setShowNewResumeModal(false);
      setNewResumeName("");
    }
  }, [newResumeName, resumes, resumeStorage]);

  /**
   * Effect: Focus the input field when new resume modal is shown
   */
  useEffect(() => {
    if (showNewResumeModal && newResumeInputRef.current) {
      newResumeInputRef.current.focus();
    }
  }, [showNewResumeModal]);

  /**
   * Creates a component that displays suggestions for a specific markdown tag
   *
   * @param tag - The HTML tag to create a component for
   * @returns A memoized component that renders the tag with suggestions
   */
  const createSuggestionsComponent = useCallback(
    (tag: keyof React.JSX.IntrinsicElements) => {
      return memo(({ children, ...props }: SuggestionComponentProps) => {
        const Tag = tag;
        const text = children?.toString() || "";

        const matchingSuggestions = suggestions?.filter((s) =>
          text.toLowerCase().includes(s.section.toLowerCase())
        );

        return (
          <>
            <Tag {...props}>{children}</Tag>
            {matchingSuggestions?.map((s, i) => (
              <div
                key={i}
                className="mt-2 p-2 bg-gray-100 italic text-sm rounded"
              >
                {s.suggestion}
              </div>
            ))}
          </>
        );
      });
    },
    [suggestions]
  );

  /**
   * Handles deleting the current resume
   */
  const handleDeleteResume = useCallback(() => {
    if (resumes.length <= 1) {
      alert("You cannot delete the only resume. Create another one first.");
      return;
    }

    // Delete the current resume
    resumeStorage.deleteResume(currentResume);

    // Update resumes list
    const newResumesList = resumes.filter((r) => r !== currentResume);
    setResumes(newResumesList);

    // Switch to another resume
    setCurrentResume(newResumesList[0]);
    setContent(resumeStorage.getResumeContent(newResumesList[0]));

    setShowDeleteResumeModal(false);
  }, [currentResume, resumes, resumeStorage]);

  // Memoized component render functions to avoid unnecessary re-renders
  const renderNewResumeModal = useMemo(
    () => (
      <Modal
        isOpen={showNewResumeModal}
        onClose={() => setShowNewResumeModal(false)}
      >
        <h2 className="text-xl font-bold mb-4">Create New Resume</h2>
        <input
          ref={newResumeInputRef}
          type="text"
          className="w-full p-2 border rounded mb-4"
          placeholder="Enter resume name"
          value={newResumeName}
          onChange={(e) => setNewResumeName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreateNewResume();
          }}
        />
        <div className="flex justify-end gap-2">
          <button
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
            onClick={() => {
              setShowNewResumeModal(false);
              setNewResumeName("");
            }}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            onClick={handleCreateNewResume}
          >
            Create
          </button>
        </div>
      </Modal>
    ),
    [showNewResumeModal, newResumeName, handleCreateNewResume]
  );

  const renderDeleteResumeModal = useMemo(
    () => (
      <Modal
        isOpen={showDeleteResumeModal}
        onClose={() => setShowDeleteResumeModal(false)}
      >
        <h2 className="text-xl font-bold mb-4">Delete Resume</h2>
        <p className="mb-4">
          Are you sure you want to delete "{currentResume}"? This action cannot
          be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
            onClick={() => setShowDeleteResumeModal(false)}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
            onClick={handleDeleteResume}
          >
            Delete
          </button>
        </div>
      </Modal>
    ),
    [showDeleteResumeModal, currentResume, handleDeleteResume]
  );

  /**
   * Memoized components for the markdown editor
   */
  const editorComponents = useMemo(
    () => ({
      p: createSuggestionsComponent("p"),
      h1: createSuggestionsComponent("h1"),
      h2: createSuggestionsComponent("h2"),
      h3: createSuggestionsComponent("h3"),
      li: createSuggestionsComponent("li"),
      blockquote: createSuggestionsComponent("blockquote"),
    }),
    [createSuggestionsComponent]
  );

  return (
    <div className="min-h-screen bg-gray-100">
      {renderNewResumeModal}
      {renderDeleteResumeModal}

      <header className="bg-white shadow-sm p-4">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <h1 className="text-2xl font-bold">Markdown Resume Builder</h1>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <div className="relative flex-grow sm:flex-grow-0 max-w-[200px] sm:w-[200px]">
              <select
                className="w-full p-2 border rounded pr-12"
                value={currentResume}
                onChange={(e) => {
                  if (e.target.value === "new") {
                    setShowNewResumeModal(true);
                  } else {
                    setCurrentResume(e.target.value);
                  }
                }}
              >
                {resumes.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
                <option value="new">Create New Resume</option>
              </select>
              <button
                className="absolute right-0 top-0 h-full px-2 bg-red-500 text-white rounded-r hover:bg-red-600"
                onClick={() => setShowDeleteResumeModal(true)}
                title="Delete current resume"
              >
                X
              </button>
            </div>
            <select
              className="p-2 border rounded flex-grow sm:flex-grow-0 max-w-[200px] sm:w-[200px]"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value as Model)}
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              onClick={exportPDF}
            >
              Export PDF
            </button>
            <button
              className={`px-4 py-2 ${
                autoSuggest ? "bg-green-500" : "bg-gray-500"
              } text-white rounded hover:bg-opacity-90`}
              onClick={toggleAutoSuggest}
              title={
                autoSuggest
                  ? "Disable auto-suggestions"
                  : "Enable auto-suggestions"
              }
            >
              {autoSuggest ? "Auto-Suggest: ON" : "Auto-Suggest: OFF"}
            </button>
            {!autoSuggest && (
              <button
                className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
                onClick={generateSuggestions}
                disabled={isLoadingSuggestions || !!apiCooldownRef.current}
              >
                Get Suggestions
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="p-4">
        <div className="md:hidden mb-4">
          <button
            className="w-full px-4 py-2 bg-gray-200 rounded"
            onClick={togglePreviewMode}
          >
            Switch to {previewMode === "edit" ? "Preview" : "Editor"}
          </button>
        </div>

        <div>
          <div data-color-mode="light">
            <MDEditor
              value={content}
              onChange={handleContentChange}
              preview={previewMode}
              height={editorHeight}
              previewOptions={{
                components: editorComponents,
              }}
              textareaProps={{
                placeholder: "Start typing your resume here...",
              }}
              visibleDragbar={false}
            />
          </div>

          {isLoadingSuggestions && (
            <div className="mt-4 p-3 bg-blue-50 text-blue-700 rounded flex items-center justify-center">
              <svg
                className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <span className="whitespace-nowrap">
                Generating suggestions...
              </span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
