/**
 * Grupos de componentes de `openuiChatLibrary` (@openuidev/react-ui 0.18).
 *
 * Se fijan aquí en vez de leerlos de `library.componentGroups`: en el bundle de
 * servidor de Next esa propiedad no está disponible, aunque sí en las pruebas.
 * `groups.test.ts` comprueba que esta tabla sigue coincidiendo con la librería, de
 * modo que una actualización de OpenUI que añada o mueva componentes no pase
 * desapercibida.
 */
export const OPENUI_GROUPS: Record<string, string[]> = {
  "Content": ["CardHeader", "TextContent", "MarkDownRenderer", "Callout", "TextCallout", "Image", "ImageBlock", "ImageGallery", "CodeBlock", "Separator", "InlineHeader"],
  "Tables": ["Table", "Col", "EditableTable"],
  "Charts (2D)": ["BarChart", "LineChart", "AreaChart", "RadarChart", "HorizontalBarChart", "Series"],
  "Charts (1D)": ["PieChart", "RadialChart", "SingleStackedBarChart", "Slice"],
  "Charts (Scatter)": ["ScatterChart", "ScatterSeries", "Point"],
  "Forms": ["Form", "FormControl", "Label", "Input", "TextArea", "Select", "SelectItem", "DatePicker", "Slider", "CheckBoxGroup", "CheckBoxItem", "RadioGroup", "RadioItem", "SwitchGroup", "SwitchItem", "Chips", "ChipItem", "OptionCards", "OptionCard"],
  "Buttons": ["Button", "Buttons", "Icon", "IconButton"],
  "Lists & Follow-ups": ["ListBlock", "ListItem", "FollowUpBlock", "FollowUpItem"],
  "Sections": ["SectionBlock", "SectionItem"],
  "Layout": ["Tabs", "TabItem", "Accordion", "AccordionItem", "Steps", "StepsItem", "Carousel"],
  "Data Display": ["TagBlock", "Tag", "EntityList"],
  "Cards": ["SnippetCardBlock", "SnippetCardItem", "OverviewCardBlock", "OverviewCardItem", "ContextCardBlock", "ContextCardItem", "CompositeCardBlock", "CompositeCardItem", "VisualCardBlock", "VisualCardItem", "Text", "BoldText", "IconText", "ImageText", "ImageTextLarge", "MetricIndicatorInline", "MetricIndicatorWithStrikethrough"],
};
