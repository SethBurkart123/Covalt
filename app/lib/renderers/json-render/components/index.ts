// Default registry of <json-render> component renderers. Plugins that want to
// extend this set can spread it into their own registry:
//   { ...defaultJsonRenderRegistry, MyCustom: myRenderer }
import type { ComponentRegistry } from "../engine";
import { Box } from "./Box";
import { Text } from "./Text";
import { Heading } from "./Heading";
import { Divider } from "./Divider";
import { Newline } from "./Newline";
import { Spacer } from "./Spacer";
import { BarChart } from "./BarChart";
import { Sparkline } from "./Sparkline";
import { Table } from "./Table";
import { List } from "./List";
import { Card } from "./Card";
import { StatusLine } from "./StatusLine";
import { KeyValue } from "./KeyValue";
import { Badge } from "./Badge";
import { ProgressBar } from "./ProgressBar";
import { Metric } from "./Metric";
import { Callout } from "./Callout";
import { Timeline } from "./Timeline";

export const defaultJsonRenderRegistry: ComponentRegistry = {
  Box,
  Text,
  Heading,
  Divider,
  Newline,
  Spacer,
  BarChart,
  Sparkline,
  Table,
  List,
  Card,
  StatusLine,
  KeyValue,
  Badge,
  ProgressBar,
  Metric,
  Callout,
  Timeline,
};
